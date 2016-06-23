var _ = require('underscore')
var dbdiff = require('dbdiff')
var PostgresClient = require('./postgresql-client')

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
      type = 'timestamp without timezone'
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
    name = name || `${this.table.name}_${this.column.name}_pk`
    this.t.primaryKey(name, this.column.name)
    return this
  }

  foreignKey (name, referencedTable, referencedColumn) {
    name = name || `${this.table.name}_${this.column.name}_fk`
    this.t.foreignKey(name, [this.column.name], referencedTable, referencedColumn)
    return this
  }

  index (name, type) {
    name = name || `index_${this.table.name}_${this.column.name}`
    type = type || 'GIST'
    this.table.indexes.push({ name, type, columns: [this.column.name] })
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
      params.push(obj[key])
      return key + '=$' + params.length
    }).join(', ')
  }

  _ands (keys, obj, params, operator) {
    return keys.map((key) => {
      params.push(obj[key])
      if (operator && key.indexOf(' ') > 0) {
        return key + '$' + params.length
      }
      return key + '=$' + params.length
    }).join(' AND ')
  }

  insert (obj) {
    var keys = this._keys(obj)
    var fields = keys.join(', ')
    var params = []
    return this.client.findOne(`
      INSERT INTO ${this.table.schema}.${this.table.name} (${fields})
      VALUES (${this._placeholders(keys, obj, params)}) RETURNING id
    `, params)
  }

  update (obj) {
    var keys = this._keys(obj)
    var fields = _.difference(keys, this.pks)
    var params = []
    return this.client.execute(`
      UPDATE ${this.table.schema}.${this.table.name}
      SET ${this._pairs(fields, obj, params)}
      WHERE ${this._ands(this.pks, obj, params)}
    `, params)
  }

  updateWhere (obj, where) {
    var params = []
    return this.client.execute(`
      UPDATE ${this.table.schema}.${this.table.name}
      SET ${this._pairs(this._keys(obj), obj, params)}
      WHERE ${this._ands(this._keys(where), where, params, true)}
    `, params)
  }

  selectOne (obj) {
    var keys = this._keys(obj || {})
    var params = []
    return this.client.findOne(`
      SELECT * FROM ${this.table.schema}.${this.table.name}
      WHERE ${this._ands(keys, obj, params, true)}
    `, params)
  }

  selectAll (obj, options = {}) {
    var keys = this._keys(obj || {})
    var params = []
    return this.client.find(`
      SELECT * FROM ${this.table.schema}.${this.table.name}
      ${keys.length > 0 ? `WHERE ${this._ands(keys, obj, params, true)}` : ''}
      ${options.groupBy ? 'GROUP BY ' + options.groupBy : ''}
      ${options.orderBy ? 'ORDER BY ' + options.orderBy : ''}
      ${options.limit ? 'LIMIT ' + options.limit : ''}
      ${options.offset ? 'OFFSET ' + options.offset : ''}
    `, params)
  }

  delete (obj) {
    var params = []
    return this.client.execute(`
      DELETE FROM ${this.table.schema}.${this.table.name}
      WHERE ${this._ands(this.pks, obj, params, true)}
    `, params)
  }

  deleteWhere (where) {
    var params = []
    return this.client.execute(`
      DELETE FROM ${this.table.schema}.${this.table.name}
      WHERE ${this._ands(this._keys(where), where, params, true)}
    `, params)
  }

  columns (alias, as = true) {
    var prefix = alias ? `${alias}.` : ''
    return Object.keys(this.cols).map((item) => prefix + item + (alias && as ? ` AS ${alias}_${item}` : '')).join(', ')
  }

  primaryKey (name, ...columns) {
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

  getColumn (name) {
    return this.cols[name]
  }

  addForeignKey (name, foreignColumn) {
    var col = this.addColumn(name, foreignColumn.column.type)
    col.foreignKey(null, foreignColumn.table.name, [foreignColumn.column.name])
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

}

exports.connect = (options) => {
  return new Seaquel(options)
}
