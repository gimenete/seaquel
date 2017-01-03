var _ = require('underscore')
var dbdiff = require('dbdiff')
var PostgresClient = require('./postgresql-client')

class Incr {

  constructor (n) {
    this.n = n
  }

}

class Column {

  constructor (t, schema, table, name, type) {
    this.t = t
    this.schema = schema
    this.table = table
    var defaultValue = null
    if (type === String) {
      type = 'character varying(255)'
    } else if (type === Number) {
      type = 'bigint'
    } else if (type === Boolean) {
      type = 'boolean'
    } else if (type === Date) {
      type = 'timestamp with time zone'
    } else if (type === 'serial') {
      type = 'integer'
      defaultValue = `nextval('${table.name}_id_seq'::regclass)`
      schema.sequences.push({
        data_type: 'bigint',
        numeric_precision: 64,
        numeric_precision_radix: 2,
        numeric_scale: 0,
        start_value: '1',
        minimum_value: '1',
        maximum_value: '9223372036854775807',
        increment: '1',
        schema: 'public',
        name: `${table.name}_id_seq`,
        cycle: false
      })
    }
    this.column = {
      name, type,
      nullable: false,
      default_value: defaultValue
    }
    this.table.columns.push(this.column)
  }

  nullable () {
    this.column.nullable = true
    return this
  }

  default (value) {
    this.column.default_value = value
    return this
  }

  unique (name) {
    name = name || `${this.table.name}_${this.column.name}_unique`
    this.t.unique(name, this.column.name)
    return this
  }

  primaryKey (name) {
    this.t.primaryKey(name, this.column.name)
    return this
  }

  foreignKey (name, referencedTable, referencedColumn) {
    name = name || `${this.table.name}_${this.column.name}_fk`
    this.t.foreignKey(name, [this.column.name], referencedTable, referencedColumn)
    return this
  }

  index (name, type) {
    name = name || `${this.table.name}_${this.column.name}`
    type = type || type === 'boolean' ? 'BTREE' : 'GIST'
    this.table.indexes.push({ name, type, columns: [this.column.name] })
    return this
  }

  onInsert (func) {
    this._onInsert = func
    return this
  }

  onUpdate (func) {
    this._onUpdate = func
    return this
  }

}

class Table {

  constructor (client, schema, name) {
    this.client = client
    this.schema = schema
    this.cols = {}
    this.table = {
      name,
      schema: 'public',
      indexes: [],
      constraints: [],
      columns: []
    }
    schema.tables.push(this.table)
    this.pks = []
  }

  _keys (obj) {
    return Object.keys(obj).filter((key) => typeof obj[key] !== 'undefined')
  }

  _placeholders (keys, obj, params) {
    return keys.map((key) => {
      params.push(obj[key])
      return '$' + params.length
    }).join(', ')
  }

  _pairs (keys, obj, params) {
    return keys.map((key) => {
      var val = obj[key]
      if (val instanceof Incr) {
        params.push(Math.abs(val.n))
        return `"${key}" = "${key}" ${val.n > 0 ? '+' : '-'} $${params.length}`
      } else {
        params.push(val)
        return `"${key}" = $${params.length}`
      }
    }).join(', ')
  }

  _ands (keys, obj, params, operator, table = this.table.name) {
    return keys.map((key) => {
      var n = key.indexOf(' ')
      var value = obj[key]
      if (operator && n > 0) {
        var op = key.substring(n + 1).trim()
        key = key.substring(0, n).trim()
        if (value === null) {
          return `"${table}"."${key}" ${op} NULL`
        } else {
          params.push(value)
          return `"${table}"."${key}" ${op} $${params.length}`
        }
      }
      params.push(value)
      return `"${table}"."${key}" = $${params.length}`
    }).join(' AND ')
  }

  _commas (keys) {
    return keys.map((key) => `"${key}"`).join(', ')
  }

  insert (obj) {
    Object.keys(this.cols).forEach((key) => {
      var col = this.cols[key]
      if (typeof col._onInsert === 'function') {
        obj[key] = col._onInsert(obj[key])
      }
    })
    var keys = this._keys(obj)
    var params = []
    return this.client.findOne(`
      INSERT INTO ${this.table.schema}."${this.table.name}" (${this._commas(keys)})
      VALUES (${this._placeholders(keys, obj, params)}) RETURNING *
    `, params)
  }

  update (obj) {
    Object.keys(this.cols).forEach((key) => {
      var col = this.cols[key]
      if (typeof col._onUpdate === 'function') {
        obj[key] = col._onUpdate(obj[key])
      }
    })
    var keys = this._keys(obj)
    var fields = _.difference(keys, this.pks)
    var params = []
    return this.client.execute(`
      UPDATE ${this.table.schema}."${this.table.name}"
      SET ${this._pairs(fields, obj, params)}
      WHERE ${this._ands(this.pks, obj, params)}
    `, params)
  }

  updateAndSelect (obj) {
    return this.update(obj)
      .then(() => this.selectOne(obj))
  }

  updateWhere (obj, where) {
    var params = []
    return this.client.execute(`
      UPDATE ${this.table.schema}."${this.table.name}"
      SET ${this._pairs(this._keys(obj), obj, params)}
      WHERE ${this._ands(this._keys(where), where, params, true)}
    `, params)
  }

  _joins (obj, options, params) {
    var sql = ''
    ;(options.join || []).forEach((join) => {
      var operator = join.type || ''
      var model = join.table
      var through = join.through
      var as = '_' + join.as
      if (typeof through === 'string') through = [through]
      var constraint = this.table.constraints.find((constraint) => {
        if (constraint.referenced_table !== model.table.name) return false
        if (through) {
          return through.length === constraint.columns.length &&
            _.difference(through.length, constraint.columns).length === 0
        }
        return true
      })
      sql += `${operator} JOIN "${model.table.name}" "${as}" ON `
      sql += constraint.columns.map((col, i) => `"${this.table.name}"."${col}" = "${as}"."${constraint.referenced_columns[i]}"`).join(' AND ')
      var keys = Object.keys(join.where || {})
      if (keys.length > 0) {
        sql += ' AND ' + this._ands(Object.keys(join.where || {}), join.where, params, true, '_' + join.as)
      }
    })
    return sql
  }

  selectOne (obj, options) {
    return this.selectAll(obj, options).then((rows) => rows[0])
  }

  selectAll (obj, options = {}) {
    var keys = this._keys(obj || {})
    var params = []
    if (options.join) {
      var selects = [this.columns(this.table.name)].concat(
        options.join
          .filter((join) => !join.filterOnly)
          .map((join) => join.table.columns('_' + join.as))
      )
      var sql = `
        SELECT ${selects.join(', ')}
        FROM ${this.table.schema}."${this.table.name}" "${this.table.name}"
        ${keys.length > 0 ? `WHERE ${this._ands(keys, obj, params, true)}` : ''}
        ${this._joins(obj, options, params)}
        ${options.groupBy ? 'GROUP BY ' + options.groupBy : ''}
        ${options.orderBy ? 'ORDER BY ' + options.orderBy : ''}
        ${options.limit ? 'LIMIT ' + options.limit : ''}
        ${options.offset ? 'OFFSET ' + options.offset : ''}
      `
      return this.client.find(sql, params)
        .then((rows) => {
          return rows.map((row) => {
            var obj = Seaquel.pick(row, this.table.name)
            options.join.forEach((join) => {
              if (join.filterOnly) return
              obj[join.as] = Seaquel.pick(row, '_' + join.as)
            })
            return obj
          })
        })
    } else {
      return this.client.find(`
        SELECT * FROM ${this.table.schema}."${this.table.name}"
        ${keys.length > 0 ? `WHERE ${this._ands(keys, obj, params, true)}` : ''}
        ${options.groupBy ? 'GROUP BY ' + options.groupBy : ''}
        ${options.orderBy ? 'ORDER BY ' + options.orderBy : ''}
        ${options.limit ? 'LIMIT ' + options.limit : ''}
        ${options.offset ? 'OFFSET ' + options.offset : ''}
      `, params)
    }
  }

  delete (obj) {
    var params = []
    return this.client.execute(`
      DELETE FROM ${this.table.schema}."${this.table.name}"
      WHERE ${this._ands(this.pks, obj, params, true)}
    `, params)
  }

  deleteWhere (where) {
    var params = []
    return this.client.execute(`
      DELETE FROM ${this.table.schema}."${this.table.name}"
      WHERE ${this._ands(this._keys(where), where, params, true)}
    `, params)
  }

  columns (alias, as = true) {
    var prefix = alias ? `${alias}.` : ''
    return Object.keys(this.cols).map((item) => prefix + `"${item}"` + (alias && as ? ` AS "${alias}_${item}"` : '')).join(', ')
  }

  primaryKey (name, ...columns) {
    name = name || `${this.table.name}_pkey`
    this.table.constraints.push({
      name,
      schema: 'public',
      type: 'primary',
      columns
    })
    this.pks = this.pks.concat(columns)
    return this
  }

  unique (name, ...columns) {
    this.table.constraints.push({
      name,
      schema: 'public',
      type: 'unique',
      columns
    })
    return this
  }

  foreignKey (name, columns, referencedTable, referencecColumns) {
    this.table.constraints.push({
      name,
      schema: 'public',
      type: 'foreign',
      columns: columns,
      referenced_table: referencedTable,
      referenced_columns: referencecColumns
    })
    return this
  }

  addColumn (name, type) {
    var col = new Column(this, this.schema, this.table, name, type)
    this.cols[name] = col
    return col
  }

  addCreatedAtColumn (name) {
    return this.addColumn(name, Date).onInsert((value) => new Date())
  }

  addUpdatedAtColumn (name) {
    return this.addColumn(name, Date).onInsert((value) => new Date()).onUpdate((value) => new Date())
  }

  getColumn (name) {
    return this.cols[name]
  }

  addForeignKey (name, foreignColumn) {
    var col = this.addColumn(name, foreignColumn.column.type)
    col.foreignKey(null, foreignColumn.table.name, [foreignColumn.column.name])
    return col
  }

}

class Seaquel {

  constructor (options) {
    this.options = options
    this.schema = { tables: [], sequences: [], dialect: 'postgres' }
    this.tables = {}
    this.client = new PostgresClient(options)
  }

  addTable (name) {
    var table = new Table(this.client, this.schema, name)
    this.tables[name] = table
    return table
  }

  getTableNames () {
    return Object.keys(this.tables)
  }

  getTable (name) {
    return this.tables[name]
  }

  sync (type) {
    return dbdiff.describeDatabase(this.options)
      .then((schema) => {
        var diff = new dbdiff.DbDiff()
        diff.compareSchemas(schema, this.schema)
        return diff.commands(type)
      })
  }

  queryOne (sql, params) {
    return this.client.findOne(sql, params)
  }

  queryAll (sql, params) {
    return this.client.find(sql, params)
  }

  execute (sql, params) {
    return this.client.execute(sql, params)
  }

  transaction (promise, mode) {
    return this.client.transaction(promise, mode)
  }

  static pick (row, prefix) {
    var obj = {}
    prefix = prefix + '_'
    Object.keys(row).forEach((key) => {
      if (key.substring(0, prefix.length) === prefix) {
        obj[key.substring(prefix.length)] = row[key]
      }
    })
    return obj
  }

  pick (row, prefix) {
    return Seaquel.pick(row, prefix)
  }

}

exports.connect = (options) => {
  return new Seaquel(options)
}

exports.incr = (n) => new Incr(n)
