// incase of badness, we can just replay the append-only log
function _stdoutlog() { console.log(Array.prototype.join.call(arguments, '/')) }
function _noplog() { }

// the main store object
// stores can hold a direct value (getSelf())
// and can have a mapping from keys to values (possibly other stores)
// if the keys happen to be numbers, we keep track of the lowest and highest number seen
function Store(v) {
    if (!(this instanceof Store)) return new Store(v);

    Store.alloc(this);
    this._log = _stdoutlog;
    _reset(this, v)
}

// internal memory management
// all stores live on the heap
// all stores are referenced by the root store, or indirectly by other stores
// we use reference counting too keep track
// if the count becomes zero, we push it to a (auto)releasepool
// all stores have a _ptr field which is their location in the heap
Store.heap = [];
Store.nextptr = 0;
Store.releasepool = [];

Store.alloc = function alloc(s) {
    if (s._ptr || s._count) throw "fail";
    while (Store.heap[Store.nextptr]) Store.nextptr++;
    s._ptr = Store.nextptr;
    s._count = 0;
    Store.heap[s._ptr] = s;
    Store.nextptr++;
}
Store.dealloc = function dealloc(s) {
    Store.releasepool.push(s);
    process.nextTick(Store.gc);
}
Store.retain = function retain(s) {
    if (!(s instanceof Store)) return;
    s._count += 1;
}
Store.release = function release(s) {
    if (!(s instanceof Store)) return;
    s._count -= 1;
    if (s._count == 0) Store.dealloc(s);
}
Store.gc = function gc() {
    if (Store.releasepool.length == 0) return;
    for (var s = Store.releasepool.shift(); s; s = Store.releasepool.shift()) {
        if (s._count == 0) Store.heap[s._ptr] = null;
        if (s._ptr < Store.nextptr) Store.nextptr = s._ptr;
        console.log("dealloc/"+ s);
    }
}
Store.check = function check() {
    for (var i = 0, len = Store.heap.length; i < len; i++) {
        if (Store.heap[i] == null) continue;
        if (Store.heap[i]._count == 0) {
            if (Store.releasepool.indexOf(Store.heap[i]) == -1) throw "fail";
        }
    }
}
Store.dump = function dump() {
    console.log("----dump:");
    console.log("length:", Store.heap.length);
    for (var i = 0, len = Store.heap.length; i < len; i++) {
        var s = Store.heap[i];
        if (!s) continue;
        console.log(s.toString(), JSON.stringify(s._value), JSON.stringify(s._data));
    }
    console.log("----");
}

Store.prototype.retain = function retain() { this._count += 1; return this; }
Store.prototype.release = function release() {
    if (this._count <= 1) {
        Store.release(this);
        return this;
    }
    this._count -= 1;
    return this;
}

// mostly internal too, toString and toJSON give heap ref number
Store.prototype.toString = function toString() { return "@"+ this._ptr; }
Store.prototype.toJSON = function toJSON() { return this._ptr; }

// internal value management; we only store strings or stores
// notice all falsy values become the empty string
// put(key, false); assert(get(key) == "")
// put(key, "false"); assert(get(key) == "false")
// put(key, true); assert(get(key) == "true")
function _value(v) {
    if (v instanceof Store) return v;
    if (!v) return ""
    if (typeof(v) == "string") return v;
    return JSON.stringify(v);
}
function _setvalue(store, v) {
    v = _value(v);
    store._log(store, "set", JSON.stringify(v));
    store._value = v;
    return this;
}

// reset a whole store also done when store is new
function _reset(store, v) {
    store._value = null; store._data = {}; store._size = 0; store._first = 0; store._last = -1;
    store._log(store, "reset");
    return _setvalue(store, v);
}

// low level get/set/pop (pop is delete/remove)
// notice storing a bare string is an optimization; it is short for storing a new Store(string)
function _entry(v) {
    if (v instanceof Store) return v;
    if (!v) return ""
    if (typeof(v) == "object") return new Store(v);
    return String(v); // true, numbers, floats, strings
}
function _get(store, k) {
    var v = store._data[k];
    if (v === undefined) return null;
    return v;
}
function _set(store, k, v) {
    v = _entry(v);
    store._log(store, "set", k, JSON.stringify(v));
    old = store._data[k];
    Store.release(old);
    if (old === undefined) store._size += 1;
    store._data[k] = v;
    Store.retain(v);
    return v;
}
function _pop(store, k) {
    var v = store._data[k];
    if (v == undefined) return null;
    store._log(store, "pop", k);
    store._size -= 1;
    delete store._data[k];
    Store.release(v);
    return v;
}

// internal operations which involve a number key
// TODO log their operational intents before their low level modifications?
function _addfirst(store, v) {
    // does not renum indexes, instead happely starts using negative indexes
    var at = store._first = store._first - 1;
    return _set(store, String(at), v);
}
function _addlast(store, v) {
    var at = store._last = store._last + 1;
    return _set(store, String(at), v);
}
function _popfirst(store) {
    // does not renum indexes
    if (store._last < store._first) return null;
    var k = String(store._first); store._first += 1;
    if (store._last < store._first) store._last = -1; store._first = 0;
    return _pop(store, k);
}
function _poplast(store) {
    if (store._last < store._first) return null;
    var k = String(store._last); store._last -= 1;
    if (store._last < store._first) store._last = -1; store._first = 0;
    return _pop(store, k);
}
function _getlist(store, at) {
    if (store._last < store._first) return null;
    if (at < store._first || at > store._last) return null;
    return _get(store, String(at));
}
function _setlist(store, at, v) {
    if (store._last < store._first) {
        store._first = store._last = at;
        return _set(store, String(at), v);
    }
    if (at < store._first) {
        store._first = at;
    } else if (at > store._last) {
        store._last = at;
    }
    return _set(store, String(at), v);
}
function _poplist(store, at) {
    if (store._last < store._first) return null;
    if (at == store._first) return _popfirst(store);
    if (at == store._last) return _poplast(store);
    if (at < store._first || at > store._last) return null;
    // does not renum indexes
    _pop(store, String(at));
}

// public interface
Store.prototype.size = function size() { return this._size; }
Store.prototype.first = function first() { return this._first; }
Store.prototype.last = function last() { return this._last; }
Store.prototype.keys = function keys() { return Object.keys(this._data); }
Store.prototype.meta = function meta() {
    return { value: this._value, size: this._size, first: this._first, last: this._last };
}
Store.prototype.reset = function reset(v) {
    return _reset(this, v);
}

// get a hold of a store referenced under a key
// it creates a store if necesairy
Store.prototype.sub = function sub(k, create) {
    var v = this.get(k);
    if (v instanceof Store) return v;
    if (v === null && !create) return null;
    return this.set(k, new Store(v));
}

// get the value for this store
Store.prototype.getSelf = function getSelf() { return this._value; }
Store.prototype.setSelf = function setSelf(v) { return _setvalue(this, v); }

// map like operations on this store
Store.prototype.set = function set(k, v) {
    if (v === undefined) v = null;
    var at = Number(k);
    if (!isNaN(at)) return _setlist(this, at, v);
    return _set(this, String(k), v);
}
Store.prototype.get = function get(k) {
    var at = Number(k);
    if (!isNaN(at)) return _getlist(this, at);
    return _get(this, String(k))
}
Store.prototype.pop = function pop(k) {
    var at = Number(k);
    if (!isNaN(at)) return _poplist(this, at);
    return _pop(this, String(k))
}

// list/deque like operations on this store
// these will give you values without having to know their keys, since their keys are numbers
// however, keys for items will never change; so addFirst() is like unshift(), except that the
// of the newly added value is not necessarily zero
// also note, the list behaves like a sparse list:
// new(); set(0, v1); set(100, v2); assert(popLast()==v2); assert(popLast()=="")
Store.prototype.addFirst = function addFirst(v) {
    if (v === undefined) v = null;
    return _addfirst(this, v);
}
Store.prototype.getFirst = function getFirst() {
    return _getlist(this)
}
Store.prototype.popFirst = function popFirst() {
    return _popfirst(this);
}
Store.prototype.addLast = function addLast(v) {
    if (v === undefined) v = null;
    return _addlast(this, v);
}
Store.prototype.getLast = function getLast() {
    return _getlist(this)
}
Store.prototype.popLast = function popLast() {
    return _poplast(this);
}

// convenient static functions
Store.getSelf = function getSelf(s) {
    if (s instanceof Store) return s.getSelf(); return s || "";
}
Store.get = function get(s, v) {
    if (s instanceof Store) return s.get(v); return "";
}
Store.getFirst = function getFirst(s) {
    if (s instanceof Store) return s.getSelf(); return "";
}
Store.getLast = function getLast(s) {
    if (s instanceof Store) return s.getLast(); return "";
}


var root = new Store().retain();

root.setSelf("<h1>hello world</h1>\n");
root.set("?type", "text/html");

console.log("init");

var sys = require("sys");
var urllib = require("url");
var http = require("http");

// TODO this is a bit of a mess ...
var server = http.createServer(function(req, res) {
    var url = urllib.parse(req.url, true)
    var query = url.query || {};
    console.log(url);
    var path = url.pathname.split("/");
    console.log(path);

    var create = false;
    var _value = false;
    var _type = false;
    if ("value" in query) {
        create = true;
        _value = url.query.value || "";
        if ("type" in query) {
            _type = query.type || "";
        }
    }

    // lookup
    var target = root;
    var targetname = "";
    if (create) targetname = path.pop();
    for (var i = 1, len = path.length; i < len; i++) {
        var p = path[i];
        if (!p) continue;
        target = target.sub(path[i], create);
        if (!target) break;
    }

    // work
    var status = 200;
    var body = "";
    var type = "text/plain";
    if (_value !== false && target) {
        console.log("set", targetname, _value, " type:", _type);
        if (targetname) {
            target.set(targetname, _value);
            if (_type !== false) {
                target.sub(targetname).set("?type", _type);
            }
            target = target.get(targetname);
        } else {
            target.setSelf(_value);
            if (_type !== false) {
                target.set("?type", _type);
            }
        }
        status = 201;
    }

    // format response
    if (target) {
        body = Store.getSelf(target);
        type = Store.get(target, "?type") || type;
    } else {
        status = 404;
    }

    res.writeHead(status, {
        "Content-Type": type,
        "Content-Length": body.length
    });
    res.end(body);
    Store.dump();
});
server.listen(8080);
console.log("listening on port 8080");

/*
set /?value=test
get /
set /foobar?value=test
get /foobar

TODO rest of api
get /?size
get /?first
get /?last
get /?keys
*/

