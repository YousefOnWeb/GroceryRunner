import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const persons = sqliteTable('persons', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  balance: real('balance').notNull().default(0),
  typicalPlace: text('typicalPlace'),
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const personAliases = sqliteTable('personAliases', {
  id: text('id').primaryKey(),
  personId: text('personId').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
});

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  defaultPrice: real('defaultPrice'),
  source: text('source'),
  timing: text('timing', { enum: ['Fresh', 'Anytime'] }).notNull().default('Fresh'),
  pricePromptAlways: integer('pricePromptAlways', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  lastOrderedAt: text('lastOrderedAt'),
});

export const itemAliases = sqliteTable('itemAliases', {
  id: text('id').primaryKey(),
  itemId: text('itemId').notNull().references(() => items.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
});

export const placeAliases = sqliteTable('placeAliases', {
  id: text('id').primaryKey(),
  placeName: text('placeName').notNull(),
  alias: text('alias').notNull(),
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sourceAliases = sqliteTable('sourceAliases', {
  id: text('id').primaryKey(),
  sourceName: text('sourceName').notNull(),
  alias: text('alias').notNull(),
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});


export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  personId: text('personId').notNull().references(() => persons.id),
  targetDate: text('targetDate').notNull(), // 'YYYY-MM-DD'
  isSettled: integer('isPaid', { mode: 'boolean' }).notNull().default(false),
  deliveryPlace: text('deliveryPlace'),
  createdAt: text('createdAt'),
  modifiedAt: text('modifiedAt'),
});

export const orderItems = sqliteTable('orderItems', {
  id: text('id').primaryKey(),
  orderId: text('orderId').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  itemId: text('itemId').notNull().references(() => items.id),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: real('unitPrice'),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  personId: text('personId').notNull().references(() => persons.id),
  amount: real('amount').notNull(),
  date: text('date').notNull(), // ISO datetime
  type: text('type', { enum: ['PaymentReceived', 'OrderCost', 'ManualAdjustment'] }).notNull(),
  note: text('note'),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  type: text('type', { enum: ['physical_give', 'physical_take', 'meetup_task', 'general_task'] }).notNull(),
  personId: text('personId').references(() => persons.id, { onDelete: 'cascade' }), // Nullable for general tasks
  targetDate: text('targetDate'), // 'YYYY-MM-DD', nullable
  targetTime: text('targetTime'), // 'HH:MM', nullable
  locationPlace: text('locationPlace'), // Nullable
  notificationId: text('notificationId'), // Nullable
  isCompleted: integer('isCompleted', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});
