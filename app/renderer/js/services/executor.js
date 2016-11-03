import mysql from 'mysql';
import pg from 'pg';

// Disable auto convert to date in pg
// https://github.com/brianc/node-pg-types/blob/ed2d0e36e33217b34530727a98d20b325389e73a/lib/textParsers.js#L147-L149
pg.types.setTypeParser(1082, v => v); // date
pg.types.setTypeParser(1114, v => v); // timestamp without timezone
pg.types.setTypeParser(1184, v => v); // timestamp

export default class Executor {
  static execute(type, query, config) {
    switch (type) {
    case 'mysql': return this.executeMySql(query, config);
    case 'postgres': return this.executePostgres(query, config);
    }
  }

  static executeMySql(query, config) {
    let connection = mysql.createConnection({
      host: config.host,
      user: config.user,
      port: config.port,
      password: config.password,
      database: config.database,
    });

    return new Promise((resolve, reject) => {
      let start = Date.now();
      connection.query(query, (err, rows, fields) => {
        let runtime = Date.now() - start;
        connection.end();
        if (err) {
          reject(err);
        }
        else {
          resolve({ fields, rows, runtime });
        }
      });
    });
  }

  static executePostgres(query, config) {
    let options = {
      host: config.host,
      user: config.user,
      port: config.port,
      password: config.password,
      database: config.database,
    };

    return new Promise((resolve, reject) => {
      pg.connect(options, (err, client) => {
        if (err) return reject(err);
        let start = Date.now();
        client.query(query, (err, result) => {
          let runtime = Date.now() - start;
          pg.end();
          if (err) return reject(err);
          let { fields, rows } = result;
          resolve({ fields, rows, runtime });
        });
      });
    });
  }

  static fetchTableSummary(table, dataSource) {
    if (dataSource.type === 'postgres') {
      return this.fetchTableSummaryPostgres(table, dataSource);
    }

    if (dataSource.type === 'mysql') {
      return this.fetchTableSummaryMysql(table, dataSource);
    }
  }

  static fetchTableSummaryPostgres(table, dataSource) {
    // TODO: escape
    let sql = `
select
    pg_attribute.attname as name,
    pg_attribute.atttypid::regtype as type,
--  pg_attribute.atttypmod as max_length,
    case pg_attribute.attnotnull when true then 'NO' else 'YES' end as null,
--  pg_attribute.atthasdef as has_default,
    pg_attrdef.adsrc as default_value,
    pg_description.description as description
from
    pg_attribute
    left join pg_description on
        pg_description.objoid = pg_attribute.attrelid
        and pg_description.objsubid = pg_attribute.attnum
    left join pg_attrdef on
        pg_attrdef.adrelid = pg_attribute.attrelid
        and pg_attrdef.adnum = pg_attribute.attnum
where
    pg_attribute.attrelid = '${table}'::regclass
    and not pg_attribute.attisdropped
    and pg_attribute.attnum > 0
order by pg_attribute.attnum`;
    return this.executePostgres(sql, dataSource.config);
  }

  static fetchTableSummaryMysql(table, dataSource) {
    let sql = `show columns from ${table}`;
    return this.executeMySql(sql, dataSource.config);
  }

  static fetchTables(dataSource) {
    if (dataSource.type === 'mysql') {
      return this.fetchTablesMysql(dataSource);
    }

    if (dataSource.type === 'postgres') {
      return this.fetchTablesPostgres(dataSource);
    }
  }

  static fetchTablesMysql(dataSource) {
    let query = `
select table_name, table_type
from information_schema.tables
where table_schema = '${dataSource.config.database}'
    `;
    return this.executeMySql(query, dataSource.config);
  }

  static fetchTablesPostgres(dataSource) {
    let query = `
select table_schema, table_name, table_type
from information_schema.tables
where table_schema not in ('information_schema', 'pg_catalog', 'pg_internal')
    `;
    return this.executePostgres(query, dataSource.config);
  }
}
