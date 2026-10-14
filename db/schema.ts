import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const works = sqliteTable('works', {
  id: text('id').primaryKey(), data: text('data').notNull(),
  revision: integer('revision').notNull().default(1), updatedAt: text('updated_at').notNull(),
});
export const settings = sqliteTable('settings', {key: text('key').primaryKey(), data: text('data').notNull()});
export const uploads = sqliteTable('uploads', {
  key: text('key').primaryKey(), contentType: text('content_type').notNull(),
  size: integer('size').notNull(), createdAt: text('created_at').notNull(),
});
