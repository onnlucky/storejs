// TODO actually implement reading in from a list of log entries
// TODO allow blob storage without StoreContext dictating how

function StoreContext() {
    if (!(this instanceof StoreContext)) return new StoreContext();

    // incase of badness, we can just replay the append-only log
    var _log = [];
    function log() { _log.push(Array.prototype.join.call(arguments, '/')); }
    this.fetchlog = function fetchlog() { var l = _log; _log = []; return l; }

    // the main store object
    // stores can hold a direct value (under the empty string as key)
    // and can have a mapping from keys to values (possibly other stores)
    // if the keys happen to be numbers, we keep track of the lowest and highest number seen
    function Store(v) {
        if (!(this instanceof Store)) return new Store(v);
        Store.alloc(this);
        _new(this, v)
    }
    this.Store = Store; // public api

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
        if (s._ptr || s._count) throw new Error("fail");
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
        if (!(s instanceof Store)) return s;
        s._count += 1;
        return s;
    }
    Store.release = function release(s) {
        if (!(s instanceof Store)) return s;
        s._count -= 1;
        if (s._count == 0) Store.dealloc(s);
        return s;
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
            var s = Store.heap[i];
            if (s == null) continue;

            var size = Object.keys(s._data).length;
            if ("" in s._data) size--;
            if (size != s._size) throw new Error(""+ s +"._size != "+ size);

            if (s._count == 0) {
                if (Store.releasepool.indexOf(s) == -1) throw new Error(""+ s +"._count == 0");
            }
        }
    }
    Store.dump = function dump() {
        console.log("----dump:");
        console.log("length:", Store.heap.length);
        for (var i = 0, len = Store.heap.length; i < len; i++) {
            var s = Store.heap[i];
            if (!s) continue;
            console.log(s.toString(), s._count, s._size, JSON.stringify(s._data));
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

    // mostly internal too, toString and toJSON give heap ptr number
    Store.prototype.toString = function toString() { return "@"+ this._ptr; }
    Store.prototype.toJSON = function toJSON() { return this._ptr; }

    // internal value management; we only store strings or stores
    // storing a bare string is an optimization; it is short for storing a new Store(string)
    // all falsy values become the empty string
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
        log(store, "set", JSON.stringify(v));
        store._value = v;
        return store;
    }

    // reset a whole store also done when store is new
    function _new(store, v) {
        store._data = {}; store._size = 0; store._first = 0; store._last = -1;
        log(store, "new");
        if (!v) return store;
        return _set(store, "", v);
    }

    // low level get/set/pop (pop is delete/remove)
    function _get(store, k) {
        var v = store._data[k];
        if (v === undefined) return null;
        return v;
    }
    function _set(store, k, v) {
        v = _value(v);
        log(store, "set", k, JSON.stringify(v));
        old = store._data[k];
        Store.release(old);
        if (old === undefined && k != "") store._size += 1;
        store._data[k] = v;
        Store.retain(v);
        return v;
    }
    function _pop(store, k) {
        var v = store._data[k];
        if (v == undefined) return null;
        log(store, "pop", k);
        if (k != "") store._size -= 1;
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
        return _new(this, v);
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
    Store.prototype.value = function value() { return this._get(this, ""); }

    // map like operations on this store
    Store.prototype.set = function set(k, v) {
        if (v === undefined) v = null;
        var at = Number(k);
        if (!isNaN(at) && k !== "") return _setlist(this, at, v);
        return _set(this, String(k), v);
    }
    Store.prototype.get = function get(k) {
        var at = Number(k);
        if (!isNaN(at) && k !== "") return _getlist(this, at);
        return _get(this, String(k))
    }
    Store.prototype.pop = function pop(k) {
        var at = Number(k);
        if (!isNaN(at) && k !== "") return _poplist(this, at);
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
    Store.value = function value(s) {
        if (s instanceof Store) return s.value(); return s || "";
    }
    Store.get = function get(s, v) {
        if (s instanceof Store) return s.get(v); return "";
    }
    Store.getFirst = function getFirst(s) {
        if (s instanceof Store) return s.getFirst(); return "";
    }
    Store.getLast = function getLast(s) {
        if (s instanceof Store) return s.getLast(); return "";
    }

    Store.import = function(target, obj) {
        if (typeof(obj) != "object") {
            if (target) { target.set("", obj); return target; }
            if (!obj) return "";
            return String(obj);
        }

        target = target || new Store();
        if (obj instanceof Array) {
            for (var i = 0; i < obj.length; i++) {
                target.set(i, Store.import(null, obj[i]));
            }
            return target;
        }
        for (var k in obj) {
            target.set(k, Store.import(null, obj[k]));
        }
        return target;
    }

    Store.export = function(target) {
        if (!(target instanceof Store)) return target;
        if (target.size() == 0) return target.value();

        // TODO if only numeric, we could export an array
        var res = {};
        var keys = target.keys();
        var k = null;
        while (keys.length) {
            k = keys.shift();
            res[k] = Store.export(target.get(k));
        }
        return res;
    }
}

// export the interface if nodejs is used
if (typeof(exports) != "undefined") exports.Store = Store;

// test

var db = new StoreContext();
var Store = db.Store;
var s = Store.import(null, {
    "": "my own value :)",
    foo: 1,
    baz: 2,
    bar: ["hello", "world"],
}).retain();

console.log(Store.export(s));
Store.dump();
Store.check();
console.log(db.fetchlog());

