/*globals Pouch: true, call: false, ajax: true */
/*globals require: false, console: false */

"use strict";

// Implements the API for dealing with a PouchDB peer's database over WebRTC
var PeerPouch = function(opts, callback) {
  function TODO(callback) {
    // TODO: callers of this function want implementations
    setTimeout(function () { call(callback, Pouch.Errors.NOT_IMPLEMENTED); }, 0);
  }
  
  // expect we'll need: basic identity for available peers, share per-peer connections between db instances
  
  // Our concrete adapter implementations and any additional public api
  var api = {};
  
  // Use the peer's ID (prefixed?)
  api._id = function() {
    // TODO: implement for realsies
    return Math.random().toFixed(16).slice(2);
  };
  
  // Let our users send arbitrary chatter since we have a connection anyway
  // (We'll likely use this internally for our own communications too)
  api.message = function(options, callback) {
    TODO(callback);     // we'll also want a way to listen for messages back
  };
  
  
  // Concrete implementations of abstract adapter methods
  
  api._info = function(callback) {
    TODO(callback);
  };
  api._get = function(id, opts, callback) {
    TODO(callback);
  };
  api._getAttachment = function (id, opts, callback) {
    TODO(callback);
  };
  api._allDocs = function(opts, callback) {
    TODO(callback);
  };
  api._bulkDocs = function(req, opts, callback) {
    TODO(callback);
  };
  api._changes = function(opts) {
    TODO(callback);
  };
  api._close = function(callback) {
    TODO(callback);
  };
  api._info = function(callback) {
    TODO(callback);
  };
  
  api._id = function() {
    // TODO: implement for realsies using the peer's ID and any other necessary info
    return Math.random().toFixed(16).slice(2);
  };
  
  // TODO: add appropriate support for plugins (query/spatial/etc.)
  
  return api;
};

// Don't bother letting peers nuke each others' databases
PeerPouch.destroy = function(name, callback) {
  setTimeout(function () { call(callback, Pouch.Errors.FORBIDDEN); }, 0);
};

// Can we breathe in this environment?
PeerPouch.valid = function() {
  // TODO: check for WebRTC+DataConnection support
  return true;
};


PeerPouch._types = {
  presence: 'com.stemstorage.peerpouch.presence',
  signal: 'com.stemstorage.peerpouch.signal',
  ddoc_name: 'peerpouch-dev'
}

var _t = PeerPouch._types;     // local alias for brevitation…
function _ddoc_replacer(k,v) {
  return (typeof v === 'function') ? v.toString().replace(/_t.(\w+)/, function (m,t) {    // …and hacky unbrevitation
    return JSON.stringify(_t[t]);
  }) : v;
}
function _jsonclone(d, r) {
  //return JSON.parse(JSON.stringify(d,r));
  
  // WORKAROUND: https://code.google.com/p/chromium/issues/detail?id=222982#makechanges
  if (r) {
    function toJSON(k, d) {
      d = r(k, d);
      if (typeof d === 'object') Object.keys(d).forEach(function (k) {
        d[k] = toJSON(k,d[k]);
      });
      return d;
    }
    d = toJSON(null, d);
  }
  return JSON.parse(JSON.stringify(d));
}


PeerPouch._ddoc = _jsonclone({
  _id: '_design/' + _t.ddoc_name,
  filters: {
    signalling: function (doc, req) {
      return (doc[_t.presence] || (doc[_t.signal] && doc.recipient === req.query.identity));
    }
  },
  views: {
    peers_by_identity: {
      map: function (doc) { if (doc[_t.presence]) emit(doc.identity, doc.name); }
    }
  }
}, _ddoc_replacer);

PeerPouch.Presence = function(hub, opts) {
  opts || (opts == {});
  
  // hub is *another* Pouch instance (typically http type) — we'll use that database for communicating presence/offers/answers!
  // opts includes: name string, identity string/TBD, profile object, share {name:db}, peerUpdate callback
  // api allows: getPeers(), connectTo(), disconnect()
  
  // TODO: add concept of "separate" peer groups within a common hub?
  
  var RTCPeerConnection = window.RTCPeerConnection || webkitRTCPeerConnection || mozRTCPeerConnection,
      RTCSessionDescription = window.RTCSessionDescription || webkitRTCSessionDescription || mozRTCSessionDescription,
      RTCIceCandidate = window.RTCIceCandidate || webkitRTCIceCandidate || mozRTCIceCandidate;
  
  // TODO: make ICE (and other channel setup params?) user-configurable
  var cfg = {"iceServers":[{"url":"stun:23.21.150.121"}]},
      con = { 'optional': [{'DtlsSrtpKeyAgreement': true}, {'RtpDataChannels': true }] };
  // NOTE: createDataChannel needs `open /Applications/Google\ Chrome\ Canary.app --args --enable-data-channels` :-(
  
  var self = {
    _id: 'peer-'+Math.random().toFixed(5).slice(2),
    name: opts.name || "Friendly neighbor",
    // TODO: see if WebRTC built-in identity provider stuff useful: http://www.ietf.org/proceedings/82/slides/rtcweb-13.pdf
    identity: opts.identity || Math.random().toFixed(20).slice(2),      
    profile: opts.profile || {},
    shares: Object.keys(opts.shares || {})
  };
  self.profile.browser = opts.browser || navigator.userAgent.replace(/^.*(Firefox|Chrome|Mobile)\/([0-9.]+).*$/, "$1 $2").replace("Mobile", "Bowser");
  self[_t.presence] = true;
  
  function updateSelf(cb) {
    hub.post(self, function (e,d) {
      if (!e) self._rev = d.rev;
      else console.warn("Trouble sharing presence", e, d);
      call(cb, e, d);
    });
  }
  
  var peers = Object.create(null);     // *connected* peers
  
  function associatedConnection(peer, initiatorCB) {
    var peerInfo = peers[peer.identity];
    if (!peerInfo) {
      console.log(self.identity, "creating connection for", peer.identity);
      peerInfo = peers[peer.identity] = {};
      
      // let code below use simple callback, but make sure all interested callers notified
      peerInfo.callbacks = [initiatorCB];
      var cb = function () {
        var ctx = this, args = arguments;
        peerInfo.callbacks.forEach(function (cb) { if (cb) cb.apply(ctx, args); });
        delete peerInfo.callbacks;
        cb = null;
      }
      
      var rtc = peerInfo.connection = new RTCPeerConnection(cfg, con);
      
      function setupChannel(evt) {
        if (evt) console.log(self.identity, "received data channel", evt.channel.readyState);
        // NOTE: unreliable channel is not our preference, but that's all current FF/Chrome have
        peerInfo.channel = (evt) ? evt.channel : rtc.createDataChannel('peerpouch-dev', {reliable:false});
        peerInfo.channel.onopen = function (evt) {
          console.log(self.identity, "data channel is open");
          call(cb);
        }
      }
      if (initiatorCB) setupChannel();
      else rtc.ondatachannel = setupChannel;
      
      rtc.onnegotiationneeded = function (evt) {
        console.log(self.identity, "saw negotiation trigger and will create an offer");
        rtc.createOffer(function (offerDesc) {
            console.log(self.identity, "created offer, sending to", peer.identity);
            rtc.setLocalDescription(offerDesc);
            sendSignal(peer, _jsonclone(offerDesc));
        }, function (e) { call(cb,e); });
      };
      rtc.onicecandidate = function (evt) {
        if (evt.candidate) sendSignal(peer, {candidate:_jsonclone(evt.candidate)}, function (e) {
          if (e) throw e;
        });
      };
      // debugging
      rtc.onicechange = function (evt) {
        console.log(self.identity, "ICE change", rtc.iceGatheringState, rtc.iceConnectionState);
      }
      rtc.onstatechange = function (evt) {
        console.log(self.identity, "State change", rtc.signalingState, rtc.readyState)
      }
    } else if (peerInfo.callbacks) { 
      peerInfo.callbacks.push(initiatorCB);
    } else setTimeout(function () {
      var e = (peerInfo.channel.readyState === 'open') ? null : Error("Connection exists, but data channel not open!");
      call(initiatorCB, e);
    }, 0);
    return peerInfo.connection;
  }
  
  function sendSignal(peer, data, cb) {
    var msg = {
      sender: self.identity,
      recipient: peer.identity,
      data: data
    };
    msg[_t.signal] = true;
    hub.post(msg, cb);
  }
  function receiveSignal(peer, data) {
    console.log(self.identity, "got", data, "from", peer.identity);
    var rtc = associatedConnection(peer);
    if (data.sdp) rtc.setRemoteDescription(new RTCSessionDescription(data), function () {
      var needsAnswer = (rtc.remoteDescription.type == 'offer');
      console.log(self.identity, "set offer, now creating answer:", needsAnswer);
      if (needsAnswer) rtc.createAnswer(function (answerDesc) {
        console.log(self.identity, "got anwer, sending back to", peer.identity);
        rtc.setLocalDescription(answerDesc);
        sendSignal(peer, _jsonclone(answerDesc));
      }, function (e) { console.warn(self.identity, "couldn't create answer", e); });
    }, function (e) { console.warn(self.identity, "couldn't set remote description", e) });
    else if (data.candidate) rtc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
  
  hub.info(function (e,d) {
    if (e) throw e;
    var opts = {
      //filter: _t.ddoc_name+'/signalling',       // see https://github.com/daleharvey/pouchdb/issues/525
      include_docs: true,
      continuous:true,
      since:d.update_seq
    };
    opts.onChange = function (d) {
      var doc = d.doc;
      if (doc[_t.signal] && doc.recipient === self.identity) {
        receiveSignal({identity:doc.sender}, doc.data);
        // HACK: would hub.remove() but this is actually "simpler" due to https://github.com/daleharvey/pouchdb/issues/558
        hub.post({_id:doc._id,_rev:doc._rev,_deleted:true}, function (e) { if (e) throw JSON.stringify(e); });
      }
    };
    hub.changes(opts);
  });
  
  
  var api = {};
  
  // c.f. http://dev.w3.org/2011/webrtc/editor/webrtc.html#simple-peer-to-peer-example
  // …and http://dev.w3.org/2011/webrtc/editor/webrtc.html#peer-to-peer-data-example
  
  // share our profile via hub
  api.joinHub = function (cb) {
    updateSelf(cb);
  };
  
  api.leaveHub = function (cb) {
    hub.remove(self._id, cb);
  };
  
  api.connectToPeer = associatedConnection;
  
  api.getPeers = function (cb) {
    hub.query(_t.ddoc_name+'/peers_by_identity', {include_docs:true}, function (e, d) {
      if (e) cb(e);
      else cb(null, d.rows.filter(function (r) { return r.doc.identity !== self.identity; }).map(function (r) { return r.doc; }));
    });
  };
  
  if (!opts.nojoin) api.joinHub();
  
  return api;
};

PeerPouch.Presence.verifyHub = function (hub, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  hub.put(PeerPouch._ddoc, function (e,d) {
    // TODO: handle versioning (leave if higher minor, upgrade if lower minor, error if major difference)
    call(cb, e, (e) ? null : {version:'dev'});
  });
}


if (typeof module !== 'undefined' && module.exports) {
  // running in node
  var pouchdir = '../';
  Pouch = require(pouchdir + 'pouch.js');
  ajax = Pouch.utils.ajax;
}

// Register for our scheme
Pouch.adapter('webrtc', PeerPouch);

Pouch.dbgPeerPouch = PeerPouch;