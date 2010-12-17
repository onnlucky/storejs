var sys = require("sys");
var fs = require("fs");
var http = require("http");
var url = require("url");
var multipart = require("multipart");

var server = http.createServer(function(req, res) {
    switch (url.parse(req.url).pathname) {
        case '/': return display_form(req, res);
        case '/upload': return upload_file(req, res);
    }
    res.writeHead(404);
    res.end("oeps");
});
server.listen(8000);

function display_form(req, res) {
    res.writeHead(200, {"Content-Type": "text/html"});
    res.end(
        '<form action="/upload" method="post" enctype="multipart/form-data">'+
        '<input type="file" name="upload-file">'+
        '<input type="text" name="text" value="testvalue">'+
        '<input type="submit" value="Upload">'+
        '</form>'
    );
}

function upload_file(req, res) {
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

    var waitdone = 0;
    function done() {
        if (waitdone > 0) { waitdone--; return; }

        if (haderror) {
            res.writeHead(500, {"Content-Type": "text/plain"});
            return res.end(haderror);
        }
        res.writeHead(200, {"Content-Type": "text/plain"});
        res.end("thanks: "+ parser.bytesReceived +"/"+ parser.bytesTotal);
        console.log(parser);
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

    // when data for part is received
    parser.onData = function(chunk) {
        if (!key) return;
        if (!outstream && !val) { val = chunk; return; }

        // when we get more then one chunk, we save these in a blob
        if (!outstream) {
            waitdone++;
            outname = "f"+ Math.floor(Math.random() * 10000000) +".blob";
            outstream = fs.createWriteStream(outname);

            outstream.addListener("drain", function() { req.resume(); });
            outstream.addListener("error", function(err) {
                sys.debug("error opening blob: "+ outname +": "+ err);
                haderror = "error writing blob:" + err;
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

