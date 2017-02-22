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
    this.ssdp.on('start', () => {
      this.emit('start', true)
    })
    this.ssdp.on('delay', (obj) => {
      this.emit('delay', obj)
    })
    this.ssdp.on('error', (err) => {
      this.emit('error', {type: 'ssdp', error: err})
    })
    this.ssdp.on('bind', (socket) => {
      this.emit('bind', socket)
    })
    this.ssdp.on('response', (headers, statusCode, rinfo) => {
      this.processResponse(headers, statusCode, rinfo)
    })
    this.ssdp.on('send', (msg, ip, port) => {
      this.emit('send', msg, ip, port)
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
      this.on('start', () => {
        this.browse(serviceType)
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
    this.timer = setInterval(() => {
      search()
    }, this.searchInterval)
  }

  self.prototype.processResponse = function (headers, statusCode, rInfo) {
    this.emit('response', {headers, statusCode, referrer: rInfo})
  }

  module.exports = self
})()
