var pg = require('pg')
var url = require('url')

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

  query (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.pool.connect((err, client, done) => {
        if (err) return reject(err)
        client.query(sql, params, (err, result) => {
          done()
          err ? reject(err) : resolve(result)
        })
      })
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
