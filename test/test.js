/* global describe before it*/
var seaquel = require('../')
var assert = require('assert')
var crypto = require('crypto')
var db = seaquel.connect('postgres://aro:aro@localhost/seaquel')
var incr = seaquel.incr

var users = db.addTable('users')
users.addColumn('id', 'serial').primaryKey()
users.addColumn('first_name', String)
users.addColumn('last_name', String)
users.addColumn('email', String).unique()
users.addColumn('banned', Boolean).index(null, 'btree').default(false)
users.addColumn('password', String).nullable()
users.addColumn('invitation_code', String).onInsert((value) => value || crypto.randomBytes(6).toString('hex'))
users.addColumn('likes', 'integer').default(0)
users.addCreatedAtColumn('created_at')
users.addUpdatedAtColumn('updated_at')

var notifications = db.addTable('notifications')
notifications.addColumn('id', 'serial').primaryKey()
notifications.addColumn('text', String)
notifications.addForeignKey('user_id', users.getColumn('id'))

var userId, userId2

describe('Test everything', () => {
  before(() => {
    return db.sync('drop')
      .then((sql) => {
        if (sql.length > 0) {
          console.log('-------------------------')
          console.log(sql)
          console.log('-------------------------')
          return Promise.reject(new Error('Run the SQL above before running the tests'))
        }
      })
  })

  it('should delete all users', () => {
    return db.execute('DELETE FROM notifications')
      .then(() => db.execute('DELETE FROM users'))
  })

  it('should insert a user', () => {
    return users.insert({ first_name: 'Anakin', last_name: 'Skywalker', email: 'anakin@example.com' })
      .then((result) => {
        userId = result.id
        assert.ok(userId)
        assert.ok(result.created_at)
        assert.ok(result.updated_at)
      })
  })

  it('should update a user', () => {
    return users.update({ id: userId, first_name: 'Darth', last_name: 'Vader', email: 'vader@example.com' })
      .then((result) => {
        assert.ok(result, 1)
      })
  })

  it('should query one user', () => {
    return users.selectOne({ id: userId })
      .then((result) => {
        assert.equal(result.id, userId)
        assert.equal(result.first_name, 'Darth')
        assert.equal(result.last_name, 'Vader')
        assert.equal(result.email, 'vader@example.com')
        assert.ok(result.created_at)
        assert.ok(result.updated_at)
        assert.ok(result.updated_at > result.created_at)
      })
  })

  it('should update a user using incr()', () => {
    return users.update({ id: userId, likes: incr(100) })
      .then((result) => {
        assert.ok(result, 1)
        return users.selectOne({ id: userId })
      })
      .then((result) => {
        assert.equal(result.likes, 100)
      })
  })

  it('should update a user using a negative incr()', () => {
    return users.update({ id: userId, likes: incr(-20) })
      .then((result) => {
        assert.ok(result, 1)
        return users.selectOne({ id: userId })
      })
      .then((result) => {
        assert.equal(result.likes, 80)
      })
  })

  it('shold insert another user', () => {
    return users.insert({ first_name: 'Padmé', last_name: 'Amidala', email: 'padme@example.com' })
      .then((result) => {
        userId2 = result.id
        assert.ok(userId2)
      })
  })

  it('should query all users', () => {
    return users.selectAll()
      .then((result) => {
        assert.equal(result.length, 2)
      })
  })

  it('should select all users with an ORDER BY', () => {
    return users.selectAll(null, { orderBy: 'id' })
      .then((result) => {
        assert.equal(result.length, 2)
        assert.equal(result[0].id, userId)
        assert.equal(result[1].id, userId + 1)
      })
  })

  it('should query the users using LIMIT', () => {
    return users.selectAll(null, { orderBy: 'id', limit: 1 })
      .then((result) => {
        assert.equal(result.length, 1)
        assert.equal(result[0].id, userId)
      })
  })

  it('should query the users with OFFSET', () => {
    return users.selectAll(null, { orderBy: 'id', offset: 1 })
      .then((result) => {
        assert.equal(result.length, 1)
        assert.equal(result[0].id, userId + 1)
      })
  })

  it('should query the users with LIMIT and OFFSET', () => {
    return users.selectAll(null, { orderBy: 'id', limit: 1, offset: 1 })
      .then((result) => {
        assert.equal(result.length, 1)
        assert.equal(result[0].id, userId + 1)
      })
  })

  it('should query the users with WHERE', () => {
    return users.selectAll({ email: 'vader@example.com' }, { orderBy: 'id' })
      .then((result) => {
        assert.equal(result.length, 1)
        assert.equal(result[0].id, userId)
      })
  })

  it('should select users with an operator', () => {
    return users.selectAll({ 'id >': userId })
      .then((result) => {
        assert.equal(result.length, 1)
        assert.equal(result[0].id, userId + 1)
      })
  })

  it('should run a custom query', () => {
    return db.queryAll('SELECT COUNT(*) AS count FROM users WHERE id > $1', [userId])
      .then((result) => {
        assert.equal(result.length, 1)
        assert.equal(result[0].count, 1)
      })
  })

  it('should run a custom query picking only one result', () => {
    return db.queryOne('SELECT COUNT(*) AS count FROM users WHERE id > $1', [userId])
      .then((result) => {
        assert.equal(result.count, 1)
      })
  })

  it('should execute a custom query', () => {
    return db.execute('UPDATE users SET banned = $1', [true])
      .then((result) => {
        assert.equal(result, 2)
      })
  })

  it('should update users with a condition', () => {
    return users.updateWhere({ banned: false }, { banned: true })
      .then((result) => {
        assert.equal(result, 2)
      })
  })

  it('should insert notifications', () => {
    return Promise.all([
      notifications.insert({ user_id: userId, text: 'A notification' }),
      notifications.insert({ user_id: userId2, text: 'Another notification' })
    ])
  })

  it('should query notifications and join their users', () => {
    return notifications.selectAll(null, {
      orderBy: 'notifications.id',
      join: [
        { model: users, as: 'user' }
      ]
    })
    .then((result) => {
      assert.equal(result.length, 2)
      assert.ok(result[0].notifications)
      assert.ok(result[0].notifications.text)
      assert.ok(result[0].user)
      assert.ok(result[0].user.first_name)
      assert.ok(result[1].notifications)
      assert.ok(result[1].notifications.text)
      assert.ok(result[1].user)
      assert.ok(result[1].user.first_name)
    })
  })

  it('should query notifications and join their users with `through`', () => {
    return notifications.selectAll(null, {
      orderBy: 'notifications.id',
      join: [
        { model: users, as: 'user', through: 'user_id' }
      ]
    })
    .then((result) => {
      assert.equal(result.length, 2)
      assert.ok(result[0].notifications)
      assert.ok(result[0].notifications.text)
      assert.ok(result[0].user)
      assert.ok(result[0].user.first_name)
      assert.ok(result[1].notifications)
      assert.ok(result[1].notifications.text)
      assert.ok(result[1].user)
      assert.ok(result[1].user.first_name)
    })
  })

  it('should query notifications and join their users with constraints', () => {
    return notifications.selectAll(null, {
      orderBy: 'notifications.id',
      join: [
        { model: users, as: 'user', where: { first_name: 'Darth' } }
      ]
    })
    .then((result) => {
      assert.equal(result.length, 1)
      assert.ok(result[0].notifications)
      assert.ok(result[0].notifications.text)
      assert.ok(result[0].user)
      assert.ok(result[0].user.first_name)
      assert.equal(result[0].user.first_name, 'Darth')
    })
  })

  it('should query notifications and join their users with constraints and a type', () => {
    return notifications.selectAll(null, {
      orderBy: 'notifications.id',
      join: [
        { model: users, as: 'user', where: { first_name: 'Darth' }, type: 'left' }
      ]
    })
    .then((result) => {
      assert.equal(result.length, 2)
      assert.ok(result[0].notifications)
      assert.ok(result[0].notifications.text)
      assert.ok(result[0].user)
      assert.ok(result[0].user.first_name)
      assert.equal(result[0].user.first_name, 'Darth')
      assert.ok(result[1].notifications)
      assert.ok(result[1].notifications.text)
      assert.ok(result[1].user)
      assert.equal(result[1].user.first_name, null)
    })
  })

  it('should query notifications and join their users with constraints but without fetching', () => {
    return notifications.selectAll(null, {
      orderBy: 'notifications.id',
      join: [
        { model: users, as: 'user', where: { first_name: 'Darth' }, filterOnly: true }
      ]
    })
    .then((result) => {
      assert.equal(result.length, 1)
      assert.ok(result[0].notifications)
      assert.ok(result[0].notifications.text)
      assert.ok(!result[0].user)
    })
  })

  it('should delete all notifications', () => {
    return db.execute('DELETE FROM notifications')
  })

  it('should delete a user', () => {
    return users.delete({ id: userId })
      .then((result) => {
        assert.equal(result, 1)
      })
  })

  it('should delete any user matching a condition', () => {
    return users.deleteWhere({ banned: false })
      .then((result) => {
        assert.equal(result, 1)
      })
  })

  it('tests the columns() utiliy method', () => {
    assert.equal(users.columns(), '"id", "first_name", "last_name", "email", "banned", "password", "invitation_code", "likes", "created_at", "updated_at"')
    assert.equal(users.columns('u'), 'u."id" AS "u_id", u."first_name" AS "u_first_name", u."last_name" AS "u_last_name", u."email" AS "u_email", u."banned" AS "u_banned", u."password" AS "u_password", u."invitation_code" AS "u_invitation_code", u."likes" AS "u_likes", u."created_at" AS "u_created_at", u."updated_at" AS "u_updated_at"')
    assert.equal(users.columns('u', false), 'u."id", u."first_name", u."last_name", u."email", u."banned", u."password", u."invitation_code", u."likes", u."created_at", u."updated_at"')
  })

  it('should give information in an error', () => {
    return db.queryAll('NONSENSE', [1337])
      .then((result) => {
        throw new Error('Query should have failed')
      })
      .catch((err) => {
        assert.ok(err.message.indexOf('NONSENSE') > 0)
        assert.ok(err.message.indexOf('1337') > 0)
        assert.ok(err.stack.indexOf('NONSENSE') > 0)
        assert.ok(err.stack.indexOf('1337') > 0)
      })
  })
})
