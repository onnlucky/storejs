// an "almost" object database with interesting semantics
// license: MIT; see license.txt
// TODO implement blobs
// TODO write some tests...

// a Store maps keys to values. Keys are strings, the empty string represents a Stores own value.
// values can be null, false, true, Numbers, Strings, or Stores. Any value but a store is a
// "shortcut" for `new Store(value)`.
// Stores have an unique id assigned to them, if you know the id, you can retrieve the store
// directly, store.id();
//
// Serialization:
// in append log: { id: "deadb33f", op: "set", key: "key", value: 1234 }\n
// whole store: { id: "deadb33f", size: 1, first: 1, last: -1,
//                data: { "": "hello", "other": { id: "cafebabe" } } }\n

// one context represents one database, the user is responsible for `fetchlog`
function StoreContext() {
    if (!(this instanceof StoreContext)) return new StoreContext();

    // random id generator
    Math.random(+new Date());
    const _rnd_length = 8;
    const _chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
    const _chars_length = _chars.length;
    function genid() {
        var cs = new Array(_rnd_length);
        for (var i = 0; i < _rnd_length; i++) cs[i] = _chars[0 | Math.random() * _chars_length];
        return cs.join("");
    }

    function trace() { console.log("store.js: "+ Array.prototype.join.call(arguments, " ")); }
    function debug() { console.log("store.js: "+ Array.prototype.join.call(arguments, " ")); }
    //function trace() {}
    //function debug() {}

    // incase of badness, we can just replay the append-only log
    var _log = [];
    function log(store, op, key, value) {
        _log.push(JSON.stringify({ id: store.id, op: op, key: key, value: value }) +"\n");
    }
    this.fetchlog = function fetchlog() { var l = _log; _log = []; return l; }

    // blob is an integration point, to delegate the data stored
    var Blob = this.Blob = function Blob() {};

    // the main store object
    // stores can hold a direct value (under the empty string as key)
    // and can have a mapping from keys to values (possibly other stores)
    // if the keys happen to be numbers, we keep track of the lowest and highest number seen
    function Store(v) {
        if (!(this instanceof Store)) return new Store(v);
        alloc(this);
        _new(this, v)
    }
    this.Store = Store; // public api

    // internal memory management
    // all stores live on the heap
    // all stores are referenced by the root store, or indirectly by other stores
    // we use reference counting too keep track
    // if the count becomes zero, we push it to a (auto)releasepool
    // all stores have a id field which is their location in the heap
    var heap = {};
    var size = 0;
    var root = null;
    var forceid = null;
    var releasepool = [];

    function alloc(s) {
        if (s.id || s._refcount) throw new Error("fail");
        s.id = forceid || genid();
        s._refcount = 0;
        if (heap[s.id]) throw new Error("fail");
        heap[s.id] = s;
        size++;
    }
    function dealloc(s) {
        releasepool.push(s);
    }
    function retain(s) {
        if (!(s instanceof Store)) return s;
        s._refcount += 1;
        return s;
    }
    function release(s) {
        if (!(s instanceof Store)) return s;
        s._refcount -= 1;
        if (s._refcount == 0) dealloc(s);
        return s;
    }
    this.gc = function gc() {
        if (releasepool.length == 0) return false;
        for (var s = releasepool.shift(); s; s = releasepool.shift()) {
            if (s._refcount == 0) {
                size--;
                delete heap[s.id];
                debug("dealloc:", s.id, "new size:", size);
            }
        }
        return true;
    }
    this.check = function check() {
        // TODO fix this ...
        for (var i = 0, len = heap.length; i < len; i++) {
            var s = heap[i];
            if (s == null) continue;

            var size = Object.keys(s._data).length;
            if ("" in s._data) size--;
            if (size != s._size) throw new Error(""+ s +"._size != "+ size);

            if (s._refcount == 0) {
                if (releasepool.indexOf(s) == -1) throw new Error(""+ s +"._refcount == 0");
            }
        }
    }
    this.dump = function dump() {
        console.log("----dump:");
        console.log("size:", size);
        var keys = Object.keys(heap);
        for (var i = 0, len = keys.length; i < len; i++) {
            var s = heap[keys[i]];
            console.log(s._refcount, _serialize(s));
        }
        console.log("----");
    }

    Store.prototype.retain = function() { return retain(this); }
    Store.prototype.release = function() { return release(this); }

    // mostly internal too, toString and toJSON give heap id number
    Store.prototype.toString = function toString() { return "@"+ this.id; }
    Store.prototype.toJSON = function toJSON() { return { id: this.id } }

    function _serialize(s) {
        return JSON.stringify({
            id: s.id,
            size: s._size,
            first: s._first,
            last: s._last,
            data: s._data,
        });
    }

    // internal value management; we only store stores or non object types
    // storing a bare value is an optimization; it is short for storing a new Store(value)
    // if you wish to store complex objects, use Store.import() instead
    function _value(v) {
        if (v instanceof Store) return v;
        if (v instanceof Blob) return v;
        if (v === undefined) return null;
        if (typeof(v) == "object") return JSON.stringify(v);
        return v;
    }

    // reset a whole store also done when store is new
    function _new(store, v) {
        trace("new:", store);
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
        trace("set:", store, k, JSON.stringify(v).slice(0, 40));
        log(store, "set", k, v);
        old = store._data[k];
        release(old);
        if (old === undefined && k != "") store._size += 1;
        store._data[k] = v;
        retain(v);
        return v;
    }
    function _pop(store, k) {
        var v = store._data[k];
        if (v == undefined) return null;
        log(store, "pop", k);
        if (k != "") store._size -= 1;
        delete store._data[k];
        release(v);
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
        if (!k) return this;

        var v = this.get(k);
        if (v instanceof Store) return v;
        if (!create) return v;
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
    Store.sub = function get(s, k, create) {
        if (s instanceof Store) return s.sub(k, create);
        if (!k) return s;
        return null;
    }
    Store.get = function get(s, k) {
        if (s instanceof Store) return s.get(k);
        if (!k) return s;
        return "";
    }
    Store.getFirst = function getFirst(s) {
        if (s instanceof Store) return s.getFirst(); return "";
    }
    Store.getLast = function getLast(s) {
        if (s instanceof Store) return s.getLast(); return "";
    }

    Store.import = function import(target, obj) {
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

    Store.export = function export(target) {
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

    function getStore(id) {
        var s = heap[id];
        if (!s) throw new Error("bad/unknown store id? " + id);
        return s;
    }

    this.replay = function replay(text) {
        var entry = JSON.parse(text);
        var val = entry.value;
        if (typeof(val) == "object") {
            if (val.id) val = getStore(val.id);
            else if (val.blob) val = getBlob(val.blob);
        }
        var store = null;
        switch (entry.op) {
            case "new":
                // this influences the alloc function ...
                forceid = entry.id;
                store = new Store();
                forceid = null;
                if (entry.id != store.id) throw new Error("wrong id: "+ entry.id, +" != "+ store.id);
                break;
            case "set":
                store = getStore(entry.id);
                store.set(entry.key, val);
                break;
            case "pop":
                store = getStore(entry.id);
                store.pop(entry.key);
                break;
            default:
                throw new Error("unknown operation: "+ op);
        }
        return store;
    }
}

// export the interface if nodejs is used
if (typeof(exports) != "undefined") exports.StoreContext = StoreContext;

/*
var conn = new RemoteStoreContext("http://there:3000/");
var s = conn.get("foo");

s.on("load", function(e) {
    console.log("s.keys()", s.keys());
    //e.set = { "id1": v1 ... }
    s.listen();
});

s.on("change", function(e) {
    console.log("change:", e);
    //e.pop = { "id1": true, ... }
    //e.popCount = 1
    //e.set = { "id2": v2, ... }
    //e.setCount = 1
});
*/

