'use strict';

(function () {
  var inherits = require('util').inherits
  var EventEmitter = require('events').EventEmitter
  var constants = require('./constants')
  var extend = require('extend')
  var SSDP = require('./core')

  var self = function (opts) {
    this.advertisementInterval = opts.advertisementInterval || 10
    this.description = opts.description || 'upnp/desc.php'
    this.packetTtl = opts.packetTtl || 1800
    this.suppressRootDeviceAdvertisement = opts.suppressRootDeviceAdvertisement || false
    this.extraHeaders = opts.headers || {}
    this.location = opts.location || constants.location

    if (!this.suppressRootDeviceAdvertisement) {
      this.usns[constants.udn] = constants.udn
    }
    opts.bindPort = 1900
    this.ssdp = new SSDP(opts)
    this.timer = false
  }
  inherits(self, EventEmitter)

  self.prototype.start = function () {
    this.ssdp.on('start', () => {
      this.emit('start', true)
      this.timer = setInterval(() => {
        this.adverise()
      }, this.advertisementInterval)
      this.advertise()
    })
    this.ssdp.on('delay', (obj) => {
      this.emit('delay', obj)
    })
    this.ssdp.on('error', (err) => {
      this.emit('error', {type: 'ssdp', error: err})
    })
    this.ssdp.on('msearch', (headers, statusCode, rinfo) => {
      this.respondToSearch(headers.ST, rinfo)
    })
    this.ssdp.on('send', (msg, ip, port) => {
      this.emit('send', msg, ip, port)
    })
    this.ssdp.start()
  }

  self.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer)
    this.ssdp.stop()
  }

  self.prototype.advertise = function () {
    if (!this.timer) {
      this.on('start', () => {
        this.advertise()
      })
      this.start()
    }

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

      this.ssdp.sendMulticast(new Buffer(message))
      this.emit('advertise', message)
    }
  }

  self.prototype.addUSN = function (device) {
    this.usns[device] = constants.udn + '::' + device
  }

  self.prototype.respondToSearch = function (serviceType, rinfo) {
    var peer = {
      address: rinfo.address,
      port: rinfo.port
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
        var pkt = this.getSSDPHeader('200 OK', extend({
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

        this.ssdp.sendUnicast(message, peer.addr, peer.port)
      }
    }
  }

  module.exports = self
})()
