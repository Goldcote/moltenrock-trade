// migrations/*.sql are bundled as text (see [[rules]] in wrangler.toml).
declare module '*.sql' {
  const sql: string;
  export default sql;
}
