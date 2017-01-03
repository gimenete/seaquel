const pg = require('pg')
const url = require('url')
const ns = require('continuation-local-storage').createNamespace('seaquel')

const domains = {
  set (key, value) {
    ns.set(key, value)
  },

  get (key) {
    return ns.get(key)
  },

  delete (key) {
    ns.active && ns.set(key, null)
  },

  run (callback) {
    ns.run(callback)
  }
}

class PostgresClient {
  constructor (options) {
    if (typeof options === 'string') {
      var parts = url.parse(options, true)
      var x = parts.host.indexOf(':')
      options = {}
      options.host = parts.hostname
      options.port = x > 0 ? +parts.host.substring(x + 1) : 5432
      options.database = parts.pathname.substring(1)
      var auth = parts.auth
      if (auth) {
        var n = auth.indexOf(':')
        if (n > 0) {
          options.user = auth.substring(0, n)
          options.password = auth.substring(n + 1)
        } else {
          options.user = auth
        }
      }
      if (parts.query) {
        Object.keys(parts.query).forEach((key) => {
          var value = parts.query[key]
          if (value === 'true') {
            parts.query[key] = true
          } else if (value === 'false') {
            parts.query[key] = false
          }
        })
        Object.assign(options, parts.query)
      }
    }
    this.pool = new pg.Pool(options)
  }

  execute (sql, params) {
    return this.query(sql, params).then((result) => result.rowCount)
  }

  transaction (promise, isolationLevel) {
    return new Promise((resolve, reject) => {
      domains.run(() => {
        this.pool.connect((err, client, done) => {
          if (err) return reject(err)
          const cleanup = (err) => {
            var done = domains.get('done')
            domains.delete('client')
            domains.delete('done')
            done && done()
            err ? reject(err) : resolve()
          }
          try {
            // domains.set('client', client)
            // domains.set('done', done)
            // console.log('begin')
            // see https://www.postgresql.org/docs/9.6/static/sql-begin.html
            client.query(`BEGIN ${isolationLevel ? 'ISOLATION LEVEL ' + isolationLevel : ''}`, ns.bind((err, result) => {
              if (err) return cleanup(err)
              promise()
                .then(() => {
                  client.query('COMMIT', (err, result) => {
                    // console.log('commit')
                    cleanup(err)
                  })
                })
                .catch((err) => {
                  client.query('ROLLBACK', (error, result) => {
                    // console.log('rollback')
                    cleanup(error || err)
                  })
                })
            }))
          } catch (err) {
            cleanup(err)
          }
        })
      })
    })
  }

  query (sql, params = []) {
    var stack = new Error().stack
    return new Promise((resolve, reject) => {
      var client = domains.get('client')
      if (client) {
        // console.log('using existing client')
        client.query(sql, params, ns.bind((err, result) => {
          err ? reject(err) : resolve(result)
        }))
      } else {
        // console.log('no client')
        this.pool.connect((err, client, done) => {
          if (err) return reject(err)
          client.query(sql, params, (err, result) => {
            done()
            err ? reject(err) : resolve(result)
          })
        })
      }
    })
    .catch((err) => {
      var message = `${err.message}. SQL: ${sql} params: ${JSON.stringify(params, null, 2)}`
      var error = new Error(message)
      error.stack = [message].concat(stack.split('\n').slice(1)).join('\n')
      throw error
    })
  }

  find (sql, params = []) {
    return this.query(sql, params).then((result) => result.rows)
  }

  findOne (sql, params = []) {
    return this.query(sql, params).then((result) => result.rows[0])
  }
}

module.exports = PostgresClient
