'use strict';

(function () {
  var inherits = require('util').inherits
  var EventEmitter = require('events').EventEmitter
  var dgram = require('dgram')
  var os = require('os')
  var net = require('net')
  var extend = require('extend')
  var constants = require('./constants')

  var regex = {
    http: /HTTP\/\d{1}\.\d{1} \d+ .*/,
    ssdp: /^([^:]+):\s*(.*)$/
  }

  var version = {
    node: process.version.substr(1),
    module: 1.0,
    name: 'node-ssdp-js'
  }

  var self = function (opts) {
    opts = opts || {}
    this.running = false
    this.sig = opts.sig || 'node.js/' + version.node + ' ' + version.name + '/' + version.module
    this.multicastIp = (net.isIP(opts.multicastIp) !== 0) ? opts.multicastIp : '239.255.255.250'
    this.port = opts.port || 1900
    this.host = this.multicastIp + ':' + this.port
    this.ttl = opts.ttl || 1
    this.advertisementInterval = opts.advertisementInterval || 10
    this.bindHost = opts.bindHost || false
    this.bindPort = opts.bindPort || 0
    this.location = opts.location // not sure what the alternate is
    this.udn = opts.udn || 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5'
    this.description = opts.description || 'upnp/desc.php'
    this.packetTtl = opts.packetTtl || 1800
    this.allowWildcards = opts.allowWildcards || false
    this.reuseAddr = opts.reuseAddr || true
    this.suppressRootDeviceAdvertisement = opts.suppressRootDeviceAdvertisement || false
    this.multicastLoopback = opts.multicastLoopback || false
    this.extraHeaders = opts.headers || {}

    this.createSockets()
  }
  inherits(self, EventEmitter)

  self.prototype.createSockets = function () {
    this.sockets = {}
    var interfaces = os.networkInterfaces()

    if (!this.bindHost || net.isIP(this.bindHost) !== 4) {
      for (var iName in interfaces) {
        var iFace = interfaces[iName]
        for (var idx in iFace) {
          var ipInfo = iFace[idx]
          if (!ipInfo.internal && ipInfo.family === 'IPv4') {
            var socket = dgram.createSocket({type: 'udp4', reuseAddr: this.reuseAddr})
            this.sockets[ipInfo.address] = socket
          }
        }
      }
    } else {
      var skt = dgram.createSocket({type: 'udp4', reuseAddr: this.reuseAddr})
      this.sockets[this.bindHost] = skt
    }
    this.emit('ready', true)
  }

  self.prototype.stop = function () {
    if (!this.sockets) return

    for (var ipAddress in this.sockets) {
      var socket = this.sockets[ipAddress]
      socket && socket.close()
    }

    this.running = false
    this.sockets = false
    this.emit('stop', true)
  }

  self.prototype.start = function () {
    if (this.running) return
    var that = this

    if (!this.sockets) this.createSockets()
    this.running = true

    for (var ipAddress in this.sockets) {
      var socket = this.sockets[ipAddress]

      socket.on('error', (err) => {
        this.emit('error', {type: 'socket', error: err})
      })

      socket.on('message', (msg, rinfo) => {
        this.parseMessage(msg, rinfo)
      })

      socket.on('listening', () => {
        var addr = socket.address()
        this.emit('listening', {address: addr})

        var addMember = function () {
          try {
            socket.addMembership(that.multicastIp, ipAddress)
            socket.setMulticastTTL(that.ttl)
            socket.setMulticastLoopback(that.multicastLoopback)
          } catch (e) {
            if (e.code === 'ENODEV' || e.code === 'EADDRNOTAVAIL') {
              that.emit('delay', {type: 'socketMembership', address: addr})
              setTimeout(() => {
                addMember()
              }, 5000)
            } else {
              that.emit('error', {type: 'socketMembership', error: e, address: addr})
            }
          }
        }
        addMember()
      })

      socket.bind({port: this.bindPort, address: ipAddress}, () => {
        this.emit('bind', socket)
      })
    }
    this.emit('start', true)
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

    this.respondToSearch(headers.ST, rinfo)
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
        }, this.extraHeaders), true
              )

        this.emit('respondToSearch', peer.addr, peer.port)

        var message = new Buffer(pkt)

        this.sendUnicast(message, peer.addr, peer.port)
      }
    }
  }

  self.prototype.parseResponse = function (msg, rinfo) {
    var headers = this.getHeaders(msg)
    var statusCode = this.getStatusCode(msg)

    this.emit('response', headers, statusCode, rinfo)
  }

  self.prototype.addUSN = function (device) {
    this.usns[device] = this.udn + '::' + device
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

  self.prototype.sendUnicast = function (message, host, port) {
    for (var ipAddress in this.sockets) {
      var socket = this.sockets[ipAddress]
      socket.send(message, port, host, (err) => {
        if (err) {
          this.emit('error', {type: 'sendUnicast', error: err})
        } else {
          this.emit('send', message, host, port)
        }
      })
    }
  }

  self.prototype.sendMulticast = function (message) {
    for (var ipAddress in this.sockets) {
      var socket = this.sockets[ipAddress]
      socket.send(message, this.port, this.multicastIp, (err) => {
        if (err) {
          this.emit('error', {type: 'sendMulticast', error: err})
        } else {
          this.emit('send', message, this.multicastIp, this.port)
        }
      })
    }
  }

  module.exports = self
})()
