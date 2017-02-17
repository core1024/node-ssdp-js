'use strict';

(function () {
  var inherits = require('util').inherits
  var EventEmitter = require('events').EventEmitter
  var constants = require('./constants')
  var SSDP = require('./core')

  var self = function (opts) {
    this.ssdp = new SSDP(opts)
    this.ssdp.on('ready', () => {
      console.warn('SSDP ready')
    })
  }
  inherits(self, EventEmitter)

  self.prototype.start = function () {
    this.ssdp.on('start', () => {
      this.emit('start', true)
    })
    this.ssdp.on('delay', (obj) => {
      console.warn(obj)
    })
    this.ssdp.on('error', (err) => {
      console.warn('Error: %o', err)
      this.emit('error', {type: 'ssdp', error: err})
    })
    this.ssdp.on('response', (headers, statusCode, rinfo) => {
      console.warn(headers, statusCode, rinfo)
    })
    this.ssdp.on('send', (msg, ip, port) => {
        // console.warn(msg, ip, port)
    })
    this.ssdp.start()
  }

  self.prototype.stop = function () {
    this.ssdp.stop()
  }

  self.prototype.search = function (serviceType) {
    if (!this.ssdp.running) {
      this.on('start', () => {
        this.search(serviceType)
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

    this.emit('msearch', message)
    this.ssdp.sendMulticast(message)
  }

  module.exports = self
})()
