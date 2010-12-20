# storejs

Storejs is a database that stores "object". These objects can be either: a
value, a list, or a map; or any combination of these at the same time (as long
as you don't confuse yourself).

Every object that acts as a map is a full key-value database in its own right.
Every object that acts as a list can also be used as a deque (push/pop/peek at
both ends).

So you have these nested objects, you approach them like you do directories:
/foo/bar access: root.get("foo").get("bar"). (You always start at root.)

The database persist by means of an append only log, which can be replayed to
restore the state of the database. This should make it durable in face of
badness.


## http

Storejs is exposed over a simple http interface, where it literally maps the
path to a series of sub-objects. It understands two "meta" properties:

 * `?type`: when doing get, serve the object with `Content-Type` set to its
   value.
 * `?access`: when traversing run its value as a function receiving a `req` as
   its only parameter. Its return value dictates if the current action is
   allowed. However, any sub-object might still change the allowed value...

The `req` parameter to a `?access` function looks like this:

    {
        method: "GET"|"SET",
        path: "/full/request/path",
        query: { param1: "value1", ... },
        op: "read" | "write" | ...,
        allow: true|false, // current value defined by parents
    }

the exposed interface looks as follows:

 * get any value: `GET /path/to/object`
 * change the value of an object: `GET /path/to/object/?value=new%20value`
 * set a new mapping to a new value: `GET /path/to/object?value=new%20value`
 * same as previous: `GET /path/to?key=object&value=new%20value`

The difference if the last two from the second is subtle but important. The
last two replace the value under a key in the parent. The second example just
updates the current value of the object, but keeps all its sub mappings as they
were.


# not yet implemented

The store objects implement more primitives, but they are not implemented yet
over http. Things like addFirst/addLast, getFirst/getLast, popFirst/popLast.

Also getting or setting large chunks as json, which is `Store.import()` and
`Store.export()` in the javascript api, is not yet available. Or listing all
keys etc.


## security

The endgoal with security is to do a capability based system: if you can access
a certain object, and that object allows you to do things, you can do that.

Now, suppose you cannot get a list of all keys in the root object, and somebody
adds an object to it under a secret (strong random value). Then nobody can
guess that secret. And only those whoe know the secret, can access the object
and thus have its capabilities.

As long as you communicate over a secure channel (https), you don't have to
expose this secret ever.

This requires:

 a. You can deny getting all keys of an object, and deny iterating all values.
 b. Requests that brute force the above, should receive a delaying penality so
    they cannot "find" strong secrets before the end of the universe.


## obvious not correct

The current system is not it, as defined by the above section...

Doing `GET /path/to/object?key=?access&value=return false` will deny any
further read/write to that object. But now nobody, not even the database admin
can change that fact. (Only using a repl or something.)

So the plan is to also allow arbitrary function execution, which are functions
that can run with unlimited permissions (or maybe just unlimited from their
place in the object graph?). You can have a `secret` admin function somewhere
(under root) that allows to reset permissions ... ?


## prototype

Anything described above is implemented, but its quality is just a prototype.
Many more things are on the todo list. But it is a nice experiment.

We should propably be "stealing" some good features from couchdb... definitely
I like the idea of "caouchapps".

Please experiment and have fun!

- Onne Gorter


# license: MIT

Copyright (c) 2010 The Authors of Storejs.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

