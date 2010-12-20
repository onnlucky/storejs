// implements an http exposed store
// license: MIT; see license.txt
// TODO implement the blobs
// TODO implement access control
// TODO nodejs enctype=uuencoded stuff?
// TODO add a function calling type? so we can have "admin" objects?


// config
var port = 8080;
var prefill = {
    "": '<h1>Welcome</h1>' +
        "<p>bootstrap yourself</p>" +
        '<form action="/result" method="post" enctype="multipart/form-data">' +
        '<input type="file" name="value">' +
        '<input type="?type" name="text" value="text/html">' +
        '<input type="submit" value="Upload">' +
        '</form>',
    "?type": "text/html",
};


// setup the database

var StoreContext = require("./store").StoreContext;

var db = new StoreContext();
var Store = db.Store;
var backend = null;
var root = null;

// create a http server

var sys = require("sys");
var fs = require("fs");
var urllib = require("url");
// TODO disabled POST for now, because multipart requires npm
//var multipart = require("multipart");
var http = require("http");

function handle_post(target, req, cb) {
    req.setEncoding("binary");

    var parser = multipart.parser();
    parser.headers = req.headers;
    req.addListener("data", function(chunk) { parser.write(chunk); });
    req.addListener("end", function() { parser.close(); });

    // state while processing parts
    var key = null;
    var val = null;
    var outstream = null;
    var outname = null;
    var haderror = false;

    var wait = 0;
    function done() {
        if (wait > 0) { wait--; return; }
        cb(haderror);
    }

    parser.onEnd = function() { done(); };

    parser.onPartBegin = function(part) {
        sys.debug("begin part name: "+ part.name +", filename: "+ part.filename);
        key = part.name;
    };

    parser.onPartEnd = function(part) {
        if (outname) val = outname;
        if (val) val = val.slice(0, 25);
        sys.debug("end part, key: '"+ key +"' value: '"+ val +"' blob:"+ !!outname);

        if (key == "value") key = ""; // value is ourselves...
        target.set(key, val);

        // reset state
        key = null;
        val = null;
        if (outstream) {
            sys.debug("closing blob file: "+ outname);
            if (outstream.writeable) outstream.end();
            outstream = null;
            outname = null;
        }
    }

    parser.onData = function(chunk) {
        if (!key) return;
        if (!outstream && !val) { val = chunk; return; }
        if (true) {
            // TODO remove this so we actually store to blobs
            val += chunk;
            return;
        }

        // when we get more then one chunk, we save these in a blob
        if (!outstream) {
            wait++;
            outname = "f"+ Math.floor(Math.random() * 10000000) +".blob";
            outstream = fs.createWriteStream(outname);

            outstream.addListener("drain", function() { req.resume(); });
            outstream.addListener("error", function(err) {
                console.log("error opening blob: '"+ outname +"':", err);
                haderror = "error writing blob";
                req.resume();
                done();
            });
            outstream.addListener("close", function() {
                req.resume();
                done();
            });
        }

        // if not writeable, we drop the data
        if (outstream.writeable) {
            req.pause();
            if (val) { outstream.write(val, "binary"); val = null; }
            outstream.write(chunk, "binary");
        }
    }
}

function checkAccess(target, request, allow) {
    var a = Store.get(target, "?access");
    if (!a) return allow;
    // TODO memoize maybe ... or store back as function?
    var fn = new Function("req", a);
    request.allow = allow;
    var res = false;
    try { res = fn(request) == true; } catch (ignore) { console.log(""+ ignore); }
    //console.log("access:", a, "allow:", res);
    return res;
}

function handle(req, res) {
    var url = urllib.parse(req.url, true)
    var query = url.query || {};
    console.log(req.method, url.pathname);

    // response state
    var status = 500;
    var body = "NOT THE BEES! AAAAAHHHHH! OH, THEY'RE IN MY EYES!";
    var type = null;
    function done(sync) {
        function done() {
            if (status == 0) throw new Error("zero status");
            body = body || "";
            res.writeHead(status, {
                "Content-Type": type || "text/plain",
                "Content-Length": body.length
            });
            res.end(body);
            console.log(status, req.method, url.pathname, body.length, body.slice(0, 40));
            status = 0;
            db.gc();
        }

        if (sync) {
            backend.writelog(db.fetchlog(), true, done);
        } else {
            done();
            backend.writelog(db.fetchlog(), false);
        }
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
    var op = (create)?"write":"read";


    // debugging
    if (query.dump) { db.dump(); }

    // path
    var path = url.pathname.split("/");
    if (create && _key === false) _key = path.pop();

    console.log("query: ", path, "key:", _key, "value:", _value);

    // for ?access management
    // TODO should be read-only ofcourse...
    var request = {
        method: req.method,
        path: url.pathname,
        query: query || {},
        op: op,
        allow: true,
    }

    // lookup
    var allow = true; // default allow everthing
    var target = root;
    allow = checkAccess(root, request, "write");
    for (var i = 1, len = path.length; i < len; i++) {
        var p = path[i];
        if (!p) continue;
        target = Store.sub(target, path[i], create);
        if (target == null) break;
        allow = checkAccess(target, request, allow);
    }

    if (!allow) {
        status = 403;
        body = "Forbidden";
        return done();
    }
    if (!target) {
        status = 404;
        body = "Not Found";
        return done();
    }
    if (!create) {
        status = 200;
        body = Store.get(target, "") || ""
        type = Store.get(target, "?type") || "text/plain";
        return done();
    }

    if (req.method == "GET") {
        console.log("created", "key:", _key, "value:", _value, "type:", _type);
        target.set(_key, _value);
        if (_type) target.sub(_key, true).set("?type", _type)
        status = 201;
        body = "";
        return done();
    }

    if (req.method == "POST") {
        handle_post(target, req, function(err) {
            if (!err) {
                status = 201;
                body = "";
            } else {
                console.log("error with post: "+ err);
                status = 500;
            }
            done();
        });
        return;
    }

    status = 500;
    done();
    console.log(req);
    throw new Error("unhanded case");
}

function done(store) {
    root = store.retain();
    var server = http.createServer(handle).listen(port);
    console.log("http interface started: ", port);
}


// load in the database

var backend = require("./filebackend").FileBackend(db);
backend.load(".", prefill, done);


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

