'use strict';

(function () {
  var inherits = require('util').inherits
  var EventEmitter = require('events').EventEmitter
  var constants = require('./constants')
  var SSDP = require('./core')

  var self = function (opts) {
    opts = opts || {}
    this.searchInterval = opts.searchInterval || 10000
    this.ssdp = new SSDP(opts)
    this.timer = false
  }
  inherits(self, EventEmitter)

  self.prototype.start = function () {
    var that = this
    this.ssdp.on('start', function() {
      that.emit('start', true)
    })
    this.ssdp.on('delay', function(obj) {
      that.emit('delay', obj)
    })
    this.ssdp.on('error', function(err) {
      that.emit('error', {type: 'ssdp', error: err})
    })
    this.ssdp.on('bind', function(socket) {
      that.emit('bind', socket)
    })
    this.ssdp.on('response', function(headers, statusCode, rinfo) {
      that.processResponse(headers, statusCode, rinfo)
    })
    this.ssdp.on('send', function(msg, ip, port) {
      that.emit('send', msg, ip, port)
    })
    this.ssdp.start()
  }

  self.prototype.stop = function () {
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.ssdp.stop()
  }

  self.prototype.browse = function (serviceType) {
    var that = this
    if (!this.ssdp.running) {
      this.on('start', function() {
        that.browse(serviceType)
      })
      return this.start()
    }

    var pkt = this.ssdp.getSSDPHeader(
        constants.msearch, {
          HOST: this.ssdp.host,
          ST: serviceType,
          MAN: '"ssdp:discover"',
          MX: 3
        }
      )

    var message = new Buffer(pkt)
    var search = function () {
      that.emit('msearch', message)
      that.ssdp.send(message)
    }
    search()
    this.timer = setInterval(function() {
      search()
    }, this.searchInterval)
  }

  self.prototype.processResponse = function (headers, statusCode, rInfo) {
    this.emit('response', {headers: headers, statusCode: statusCode, referrer: rInfo})
  }

  module.exports = self
})()
