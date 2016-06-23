# seaquel

The best of an ORM with the flexibility of writing your own SQL.

## Installing

```
npm install seaquel --save
```

## Connecting

At this moment only PostgreSQL is supported. You can either use a connection string or an object. For example:

```javascript
var seaquel = require('seaquel')
var db = seaquel.connect(process.env.DATABASE_URL)
```

Or

```javascript
var seaquel = require('seaquel')
var db = seaquel.connect({
  dialect: 'postgres', // use `mysql` for mysql
  username: 'user',
  password: 'pass',
  database: 'dbname1',
  host: 'localhost',
  dialectOptions: {
    ssl: false
  }
})
```

## Defining your schema

You can use `addTable(tableName)` to create new tables. Then you can use `addColumn(columnName, type)` to add columns to each table. The type can be a string with the name of the native type, such as `character varying(255)` or one of these:

- `String` translates to `character varying(255)`
- `Number` translates to `bigint`
- `Boolean` translates to `boolean`
- `Date` translates to `timestamp without timezone`
- `serial` translates to `int` and creates a sequence to let this field be autoincremental.

Columns are not nullable by default. You can make a column nullable with `.nullable()`.

You can define some constraints to the columns as well:

- `primaryKey()` sets the primary constraint to the column
- `unique()` creates a unique constraint on this column
- `index([[indexName], indexType])` creates an index. The default index type is `GIST`

You can create foreign keys very easily. Check the example to see all this functionality in action:

```javascript
var users = db.addTable('users')
users.addColumn('id', 'serial').primaryKey()
users.addColumn('first_name', String)
users.addColumn('last_name', String)
users.addColumn('email', String).unique()
users.addColumn('banned', Boolean).index(null, 'btree').default(false)
users.addColumn('password', String).nullable()

var notifications = db.addTable('notifications')
notifications.addColumn('id', 'serial').primaryKey()
notifications.addColumn('text', String)
notifications.addForeignKey('user_id', users.getColumn('id'))

db.sync('drop')
  .then((sql) => {
    if (sql.length > 0) {
      console.log('-------------------------')
      console.log(sql)
      console.log('-------------------------')
      console.log('Run the SQL above to match the required schema')
    }
  })
```

The `sync()` method will return SQL to match the schema in your existing database. The parameter is one of the available [safety lebels of dbdiff](https://github.com/gimenete/dbdiff#safety-level). In any case don't worry because this SQL is never executed automatically. You will need to execute it yourself.

## CRUD operations

CRUD operations are super easy. All operations return promises. Some examples:

```javascript
var users = db.addTable('users')
// ...

// Insert an object
users.insert({ first_name: 'Anakin', last_name: 'Skywalker', email: 'anakin@example.com' })

// Update an objet
users.update({ id: userId, first_name: 'Darth', last_name: 'Vader', email: 'vader@example.com' })

// Querying one object
users.selectOne({ id: userId })

// Querying all records in a table
// This method has two parameters, both optional. See below
users.selectAll()

// Querying all records specifying an ORDER BY
users.selectAll(null, { orderBy: 'id' })

// Query specifying order by, limit and offset. All are optional
users.selectAll(null, { orderBy: 'id', limit: 10, offset: 100 })

// Query specifying WHERE constraints and other options
users.selectAll({ email: 'vader@example.com' }, { orderBy: 'id' })

// Update with WHERE. The first argument is the values to set
// and the second one is the conditions to match. In this case:
// SET banned=false to all users with banned=true
users.updateWhere({ banned: false }, { banned: true })

// Delete a record
users.delete({ id: userId })

// Delete with WHERE
users.deleteWhere({ banned: false })
```

Some methods accept objects "with operators". For example:

```javascript
users.selectAll({ 'score >': 100 })
```

These methods are:

- `selectOne(where)`. This method accepts operators
- `selectAll(where)`. This method accepts operators
- `deleteWhere(where)`. This method accepts operators
- `updateWhere(obj, where)`. The second argument accepts operators


## Custom queries

This ORM wants to be as simple as possible. For any operation not covered by the high level API you can use your custom SQL. But the ORM helps you with it!

```javascript
// returns an object
db.queryOne('SELECT COUNT(*) AS count FROM users WHERE id > $1', [userId])

// returns an array of objects
db.queryAll('SELECT DISTINCT something FROM users')

// returns an integer with the number of changed rows
db.execute('CREATE EXTENSION unaccent')
```


## Utility mehtods

When you are running custom queries sometimes you need to put all the columns of one or many tables. You can use the `table.columns(alias)` method. For example:

```javascript
db.query(`
  SELECT
    ${users.columns('u')}
  FROM users u
  JOIN ...
`)
```

That query will result in:

```sql
SELECT
  u.id AS u_id, u.first_name AS u_first_name, u.last_name AS u_last_name, u.email AS u_email, u.banned AS u_banned, u.password AS u_password
FROM users u
JOIN ...
```

If no alias is passed to `columns()` in this case it will return `id, first_name, last_name, email, banned, password`.

If you pass an alias but `false` as second parameter, this is the result: `u.id, u.first_name, u.last_name, u.email, u.banned, u.password`
