// implementing the http api

var StoreContext = require("./store").StoreContext;

var db = new StoreContext();
var Store = db.Store;
var root = new Store().retain();

root.set("", "<h1>hello world</h1>\n");
root.set("?type", "text/html");

console.log("init");

var sys = require("sys");
var urllib = require("url");
var http = require("http");

// TODO this is a bit of a mess ...
var server = http.createServer(function(req, res) {
    var url = urllib.parse(req.url, true)
    var query = url.query || {};
    console.log(req.method, url.pathname);

    // response
    var status = 500;
    var body = "";
    var type = "text/plain";
    function writeResponse() {
        if (status == 0) throw "zero status"
        res.writeHead(status, {
            "Content-Type": type,
            "Content-Length": body.length
        });
        res.end(body);
        console.log(status, req.method, url.pathname, body.length, body.slice(0, 40));
        status = 0;
    }

    // decode request
    var create = false;
    var _value = ("value" in query)?query.value:false;
    var _key = ("key" in query)?query.key:false;
    var _type = query.type || false;
    if (req.method == "GET") {
        if (_value !== false) create = true;
    }
    if (req.method == "POST") {
        create = true;
        _value = "";
    }
    if (query.dump) {
        db.dump();
    }

    // path
    var path = url.pathname.split("/");
    if (create && _key === false) _key = path.pop();

    console.log("query: ", path, "key:", _key, "value:", _value);

    // lookup
    var target = root;
    for (var i = 1, len = path.length; i < len; i++) {
        var p = path[i];
        if (!p) continue;
        target = Store.sub(target, path[i], create);
        if (target == null) break;
    }

    if (!target) {
        status = 404;
        if (create) status = 403;
        body = "";
        return writeResponse();
    }

    if (!create) {
        status = 200;
        body = Store.get(target, "") || ""
        type = Store.get(target, "?type") || "text/plain";
        return writeResponse();
    }

    function doCreate() {
        console.log("created", "key:", _key, "value:", _value, "type:", _type);
        target.set(_key, _value);
        if (_type) target.sub(_key, true).set("?type", _type)
        status = 201;
        writeResponse();
    }

    if (req.method == "GET") return doCreate();
    if (req.method == "PUT") {
        // TODO
    }

    status = 500;
    writeResponse();
    throw "unhanded case";
});
server.listen(8080);
console.log("listening on port 8080");

/*
set /?value=test
set POST / data
get /
set /?key=foobar&value=test
set /foobar?self=test
get /foobar

TODO rest of api
get /?size
get /?first
get /?last
get /?keys
*/

