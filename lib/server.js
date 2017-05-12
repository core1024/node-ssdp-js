'use strict';

(function () {
  var inherits = require('util').inherits
  var EventEmitter = require('events').EventEmitter
  var constants = require('./constants')
  var extend = require('extend')
  var SSDP = require('./core')
  var uuidV4 = require('uuid/v4')

  var self = function (opts) {
    opts = opts || {}
    this.advertisementInterval = opts.advertisementInterval || 10000
    this.description = opts.description || 'upnp/desc.php'
    this.packetTtl = opts.packetTtl || 1800
    this.suppressRootDeviceAdvertisement = opts.suppressRootDeviceAdvertisement || false
    this.extraHeaders = opts.headers || {}
    this.passive = opts.passiveResponder || false
    this.queryAuthenticator = (typeof opts.queryAuthenticator === 'function') ? opts.queryAuthenticator : false

    this.usns = []
    this.location = opts.location || 'http://127.0.0.1/upnp/desc.html'
    this.udn = opts.udn || 'uuid:' + uuidV4()

    if (!this.suppressRootDeviceAdvertisement) {
      this.usns[this.udn] = this.udn
    }
    opts.bindPort = 1900
    this.ssdp = new SSDP(opts)
    this.timer = false
  }
  inherits(self, EventEmitter)

  self.prototype.start = function () {
    var that = this;
    this.ssdp.on('start', function() {
      that.emit('start', true)
      that.timer = setInterval(function() {
        that.advertise()
      }, that.advertisementInterval)
      that.advertise()
    })
    this.ssdp.on('delay', function(obj) {
      that.emit('delay', obj)
    })
    this.ssdp.on('error', function(err) {
      that.emit('error', {type: 'ssdp', error: err})
    })
    this.ssdp.on('msearch', function(headers, statusCode, rinfo) {
      that.emit('msearch', headers, statusCode, rinfo)
      that.respondToSearch(headers.ST, rinfo)
    })
    this.ssdp.on('send', function(msg, ip, port) {
      that.emit('send', msg, ip, port)
    })
    this.ssdp.start()
  }

  self.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer)
    this.ssdp.stop()
  }

  self.prototype.advertise = function (service) {
    if (!this.timer) {
      var that = this
      this.on('start', function() {
        that.advertise(service)
      })
      this.start()
    }
    if (service) this.addUSN(service)
    if (this.passive) return

    for (var usn in this.usns) {
      var udn = this.usns[usn]
      var nts = constants.alive

      var headers = {
        HOST: this.ssdp.host,
        NT: usn,
        NTS: nts,
        USN: udn,
        LOCATION: this.location,
        'CACHE-CONTROL': 'max-age=' + this.packetTtl,
        SERVER: this.ssdp.sig
      }

      extend(headers, this.extraHeaders)

      var message = this.ssdp.getSSDPHeader(constants.notify, headers)

      this.ssdp.send(new Buffer(message))
      this.emit('advertise', message)
    }
  }

  self.prototype.addUSN = function (device) {
    this.usns[device] = this.udn + '::' + device
  }

  self.prototype.respondToSearch = function (serviceType, rinfo) {
    var peer = {
      address: rinfo.address,
      port: rinfo.port
    }
    if (this.queryAuthenticator && !this.queryAuthenticator(serviceType, rinfo)) {
      return
    }
    var acceptor
    var stRegex

    if (serviceType[0] === '"' && serviceType[serviceType.length - 1] === '"') {
      serviceType = serviceType.slice(1, -1)
    }

    if (this.allowWildcards) {
      stRegex = new RegExp(serviceType.replace(/\*/g, '.*') + '$')
      acceptor = function (usn, serviceType) {
        return serviceType === constants.all || stRegex.test(usn)
      }
    } else {
      acceptor = function (usn, serviceType) {
        return serviceType === constants.all || usn === serviceType
      }
    }

    for (var usn in this.usns) {
      var udn = this.usns[usn]

      if (this.allowWildcards) {
        udn = udn.replace(stRegex, serviceType)
      }

      if (acceptor(usn, serviceType)) {
        var pkt = this.ssdp.getSSDPHeader('200 OK', extend({
          ST: serviceType === constants.all ? usn : serviceType,
          USN: udn,
          LOCATION: this.location,
          'CACHE-CONTROL': 'max-age=' + this.packetTtl,
          DATE: new Date().toUTCString(),
          SERVER: this.sig,
          EXT: ''
        }, this.extraHeaders), true)

        this.emit('respondToSearch', peer.addr, peer.port)

        var message = new Buffer(pkt)

        this.ssdp.send(message, peer.address, peer.port)
      }
    }
  }

  module.exports = self
})()
