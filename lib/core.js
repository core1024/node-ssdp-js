'use strict';

(function () {
  var inherits = require('util').inherits
  var EventEmitter = require('events').EventEmitter
  var dgram = require('dgram')
  var os = require('os')
  var net = require('net')
  var constants = require('./constants')

  var regex = {
    http: /HTTP\/\d{1}\.\d{1} \d+ .*/,
    ssdp: /^([^:]+):\s*(.*)$/
  }

  var version = {
    node: process.version.substr(1),
    module: require('../package.json').version,
    name: require('../package.json').name
  }

  var self = function (opts) {
    var that = this
    opts = opts || {}
    this.running = false
    this.sig = opts.sig || 'node.js/' + version.node + ' ' + version.name + '/' + version.module
    this.multicastIp = (net.isIP(opts.multicastIp) !== 0) ? opts.multicastIp : '239.255.255.250'
    this.port = opts.port || 1900
    this.host = this.multicastIp + ':' + this.port
    this.ttl = opts.ttl || 1
    this.bindHost = opts.bindHost || false
    this.bindPort = opts.bindPort || 0
    this.allowWildcards = opts.allowWildcards || false
    this.reuseAddr = opts.reuseAddr || true
    this.multicastLoopback = opts.multicastLoopback || false
    this.sockets = []
    this.interfaces = (function () {
      var localAddresses = []
      if (!that.bindHost || net.isIP(that.bindHost) !== 4) {
        var osInterfaces = os.networkInterfaces()
        for (var osInterface in osInterfaces) {
          var osAddresses = osInterfaces[osInterface]
          for (var i = 0; i < osAddresses.length; i++) {
            var osAddress = osAddresses[i]
            if (osAddress.internal) continue
            if (osAddress.family === 'IPv4') localAddresses.push(osAddress.address)
          }
        }
      } else {
        localAddresses.push(that.bindHost)
      }
      return localAddresses
    })()
  }
  inherits(self, EventEmitter)

  self.prototype.stop = function () {
    for (var i = 0; i < this.sockets.length; i++) {
      var socket = this.sockets[i]
      socket && socket.close()
    }

    this.running = false
    this.sockets = []
    this.emit('stop', true)
  }

  self.prototype.start = function () {
    if (this.running) return
    this.running = true

    for (var i = 0; i < this.interfaces.length; i++) {
      var iface = this.interfaces[i]
      var skt = this.createSocket(iface, this.bindPort)
      this.sockets.push(skt)
    }
    this.emit('start', true)
  }

  self.prototype.createSocket = function (address, port) {
    var that = this
    var socket = dgram.createSocket({type: 'udp4', reuseAddr: that.reuseAddr})

    socket.on('error', (err) => {
      that.on('error', {type: 'socket', socket: socket, error: err})
    })

    socket.on('message', (msg, rinfo) => {
        console.warn(msg)
      that.parseMessage(msg, rinfo)
    })

    socket.on('listening', () => {
      try {
        var addr = socket.address()
      } catch (e) {
        that.emit('error', {type: 'listenSocket', socket})
      }

      var addMember = function () {
        try {
          socket.addMembership(that.multicastIp, address)
          socket.setMulticastTTL(that.ttl)
          socket.setMulticastLoopback(that.multicastLoopback)
        } catch (e) {
          if (e.code === 'ENODEV' || e.code === 'EADDRNOAVAIL') {
            that.emit('delay', {type: 'socketMembership', address: addr})
            setTimeout(() => {
              addMember()
            }, 5000)
          } else {
            that.emit('error', {type: 'socketMembership', address: addr})
          }
        }
      }
      addMember()
    })

    socket.bind({port: port, address: address}, () => {
      that.emit('bind', socket)
    })

    return socket
  }

  self.prototype.parseMessage = function (msg, rinfo) {
    msg = msg.toString()

    var type = msg.split('\r\n').shift()

    if (regex.http.test(type)) {
      this.parseResponse(msg, rinfo)
    } else {
      this.parseCommand(msg, rinfo)
    }
  }

  self.prototype.parseCommand = function (msg, rinfo) {
    var method = this.getMethod(msg)
    var headers = this.getHeaders(msg)

    switch (method) {
      case constants.notify:
        this.notify(headers, msg, rinfo)
        break
      case constants.msearch:
        this.msearch(headers, msg, rinfo)
        break
      default:
        this.emit('error', {type: 'command', subType: 'unhandled', message: msg, rinfo})
    }
  }

  self.prototype.notify = function (headers, msg, rinfo) {
    if (!headers.NTS) return

    switch (headers.NTS.toLowerCase()) {
      case constants.alive:
        this.emit(constants.advertiseAlive, {headers, rinfo})
        break
      case constants.bye:
        this.emit(constants.advertiseBye, {headers, rinfo})
        break
      default:
        this.emit('error', {type: 'notify', subType: 'unhandled', message: msg, rinfo})
    }
  }

  self.prototype.msearch = function (headers, msg, rinfo) {
    if (!headers.MAN || !headers.MX || !headers.ST) return
    this.emit('msearch', headers, msg, rinfo)
  }

  self.prototype.parseResponse = function (msg, rinfo) {
    var headers = this.getHeaders(msg)
    var statusCode = this.getStatusCode(msg)
    this.emit('response', headers, statusCode, rinfo)
  }

  self.prototype.getSSDPHeader = function (method, headers, isResponse) {
    var message = []

    method = method.toUpperCase()

    if (isResponse) {
      message.push('HTTP/1.1 ' + method)
    } else {
      message.push(method + ' * HTTP/1.1')
    }

    for (var header in headers) {
      message.push(header + ': ' + headers[header])
    }

    message.push('\r\n')

    return message.join('\r\n')
  }

  self.prototype.getMethod = function (msg) {
    var lines = msg.split('\r\n')
    var type = lines.shift().split(' ')
    var method = (type[0] || '').toLowerCase()
    console.warn(method)
    return method
  }

  self.prototype.getStatusCode = function (msg) {
    var lines = msg.split('\r\n')
    var type = lines.shift().split(' ')
    var code = parseInt(type[1], 10)

    return code
  }

  self.prototype.getHeaders = function (msg) {
    var lines = msg.split('\r\n')

    var headers = {}

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      if (line.length) {
        var pairs = line.match(regex.ssdp)
        if (pairs) headers[pairs[1].toUpperCase()] = pairs[2]
      }
    }

    return headers
  }

  self.prototype.send = function (message, host, port) {
    var targetHost = host || this.multicastIp
    var targetPort = port || this.port

    for (var i = 0; i < this.sockets.length; i++) {
      var socket = this.sockets[i]
      socket.send(message, targetPort, targetHost, (err) => {
        if (err) {
          this.emit('error', {type: 'send', error: err})
        } else {
          this.emit('send', message, targetHost, targetPort)
        }
      })
    }
  }

  module.exports = self
})()
