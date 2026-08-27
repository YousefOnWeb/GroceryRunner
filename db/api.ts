import { and, eq, inArray, like, sql, lte } from 'drizzle-orm';
import * as crypto from 'expo-crypto';
import { db } from './index';
import { items, orderItems, orders, personAliases, persons, transactions, itemAliases, placeAliases, sourceAliases, tasks } from './schema';

export const generateId = () => crypto.randomUUID();
export const CURRENT_SCHEMA_VERSION = 3;

import { scheduleTaskNotification, cancelTaskNotification } from '../utils/notifications';

export const api = {
  addPerson: async (name: string, typicalPlace?: string | null, aliases?: string[]) => {
    const trimmed = name.trim();
    // Check if this name matches an existing person or alias
    const existingByName = await db.select().from(persons).where(sql`lower(name) = lower(${trimmed})`);
    if (existingByName.length > 0) return existingByName;

    const existingByAlias = await db.select({ personId: personAliases.personId })
      .from(personAliases)
      .where(sql`lower(alias) = lower(${trimmed})`);
    if (existingByAlias.length > 0) {
      // The name the user typed is actually an alias — return the real person
      return db.select().from(persons).where(eq(persons.id, existingByAlias[0].personId));
    }

    const personId = generateId();
    const result = await db.insert(persons).values({
      id: personId,
      name: trimmed,
      typicalPlace: typicalPlace?.trim() || null,
    }).returning();

    // Insert aliases if provided
    if (aliases && aliases.length > 0) {
      const aliasValues = aliases
        .map(a => a.trim())
        .filter(a => a.length > 0)
        .map(a => ({ id: generateId(), personId, alias: a }));
      if (aliasValues.length > 0) {
        await db.insert(personAliases).values(aliasValues);
      }
    }

    return result;
  },

  updatePerson: async (personId: string, updates: {
    name?: string;
    typicalPlace?: string | null;
    aliases?: string[];
  }) => {
    const setValues: any = {};
    if (updates.name !== undefined) setValues.name = updates.name.trim();
    if (updates.typicalPlace !== undefined) setValues.typicalPlace = updates.typicalPlace?.trim() || null;

    if (Object.keys(setValues).length > 0) {
      await db.update(persons).set(setValues).where(eq(persons.id, personId));
    }

    // Replace aliases if provided
    if (updates.aliases !== undefined) {
      await db.delete(personAliases).where(eq(personAliases.personId, personId));
      const aliasValues = updates.aliases
        .map(a => a.trim())
        .filter(a => a.length > 0)
        .map(a => ({ id: generateId(), personId, alias: a }));
      if (aliasValues.length > 0) {
        await db.insert(personAliases).values(aliasValues);
      }
    }
  },

  getPersonAliases: async (personId: string): Promise<string[]> => {
    const rows = await db.select({ alias: personAliases.alias })
      .from(personAliases)
      .where(eq(personAliases.personId, personId));
    return rows.map(r => r.alias);
  },

  getItemAliases: async (itemId: string): Promise<string[]> => {
    const rows = await db.select({ alias: itemAliases.alias }).from(itemAliases).where(eq(itemAliases.itemId, itemId));
    return rows.map(r => r.alias);
  },

  getPlaceAliases: async (placeName: string): Promise<string[]> => {
    const rows = await db.select({ alias: placeAliases.alias }).from(placeAliases).where(eq(placeAliases.placeName, placeName));
    return rows.map(r => r.alias);
  },

  getSourceAliases: async (sourceName: string): Promise<string[]> => {
    const rows = await db.select({ alias: sourceAliases.alias }).from(sourceAliases).where(eq(sourceAliases.sourceName, sourceName));
    return rows.map(r => r.alias);
  },

  /** Search persons by name or alias. Returns matched persons (deduplicated). */
  searchPersons: async (query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    // Search by name
    const byName = await db.select().from(persons)
      .where(sql`lower(name) LIKE ${'%' + q + '%'}`);

    // Search by alias
    const byAlias = await db.select({ personId: personAliases.personId })
      .from(personAliases)
      .where(sql`lower(alias) LIKE ${'%' + q + '%'}`);

    const aliasPersonIds = byAlias.map(r => r.personId);
    const matchedByNameIds = new Set(byName.map(p => p.id));

    // Fetch persons matched by alias that aren't already in byName results
    const extraIds = aliasPersonIds.filter(id => !matchedByNameIds.has(id));
    let extraPersons: typeof byName = [];
    if (extraIds.length > 0) {
      extraPersons = await db.select().from(persons).where(inArray(persons.id, extraIds));
    }

    return [...byName, ...extraPersons];
  },

  /** Resolve a typed name: check persons.name first, then aliases. Returns the person or null. */
  resolvePersonByNameOrAlias: async (input: string) => {
    const trimmed = input.trim();
    const byName = await db.select().from(persons).where(sql`lower(name) = lower(${trimmed})`);
    if (byName.length > 0) return byName[0];

    const byAlias = await db.select({ personId: personAliases.personId })
      .from(personAliases)
      .where(sql`lower(alias) = lower(${trimmed})`);
    if (byAlias.length > 0) {
      const person = await db.select().from(persons).where(eq(persons.id, byAlias[0].personId));
      return person.length > 0 ? person[0] : null;
    }

    return null;
  },

  resolvePlaceByNameOrAlias: async (input: string) => {
    if (!input) return null;
    const trimmed = input.trim();
    const byAlias = await db.select({ placeName: placeAliases.placeName })
      .from(placeAliases)
      .where(sql`lower(alias) = lower(${trimmed})`);
    if (byAlias.length > 0) return byAlias[0].placeName;
    return trimmed;
  },

  resolveSourceByNameOrAlias: async (input: string) => {
    if (!input) return null;
    const trimmed = input.trim();
    const byAlias = await db.select({ sourceName: sourceAliases.sourceName })
      .from(sourceAliases)
      .where(sql`lower(alias) = lower(${trimmed})`);
    if (byAlias.length > 0) return byAlias[0].sourceName;
    return trimmed;
  },
  
  addItem: async (name: string, description: string | null, defaultPrice: number | null, source: string | null, timing: 'Fresh' | 'Anytime', aliases?: string[], pricePromptAlways: boolean = false) => {
    const trimmed = name.trim();
    const existing = await db.select().from(items).where(sql`lower(name) = lower(${trimmed})`);
    if (existing.length > 0) return existing;
    
    let finalSource = source ? await api.resolveSourceByNameOrAlias(source) : null;

    const result = await db.insert(items).values({ id: generateId(), name: trimmed, description: description?.trim() || null, defaultPrice, source: finalSource, timing, pricePromptAlways }).returning();
    
    if (aliases && aliases.length > 0) {
      const aliasValues = aliases
        .map(a => a.trim())
        .filter(a => a.length > 0)
        .map(a => ({ id: generateId(), itemId: result[0].id, alias: a }));
      if (aliasValues.length > 0) {
        await db.insert(itemAliases).values(aliasValues);
      }
    }
    
    return result;
  },
  
  createOrder: async (personId: string, targetDate: string, orderLines: { itemId: string, quantity: number, unitPrice: number | null }[], deliveryPlace?: string | null) => {
    let totalCost = 0;
    orderLines.forEach(line => {
      totalCost += (line.quantity * (line.unitPrice || 0));
    });

    const orderId = generateId();
    let finalPlace = deliveryPlace ? await api.resolvePlaceByNameOrAlias(deliveryPlace) : null;
    const now = new Date().toISOString();

    const linesToInsert = orderLines.map(line => ({
      id: generateId(),
      orderId,
      itemId: line.itemId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    }));

    await db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        personId,
        targetDate,
        isSettled: false,
        deliveryPlace: finalPlace,
        createdAt: now,
      });
      
      if (linesToInsert.length > 0) {
        await tx.insert(orderItems).values(linesToInsert);
        
        const itemIds = Array.from(new Set(orderLines.map(line => line.itemId)));
        if (itemIds.length > 0) {
          await tx.update(items)
            .set({ lastOrderedAt: now })
            .where(inArray(items.id, itemIds));
        }
      }

      if (totalCost > 0) {
        await tx.update(persons)
          .set({ balance: sql`${persons.balance} - ${totalCost}` })
          .where(eq(persons.id, personId));

        await tx.insert(transactions).values({
          id: generateId(),
          personId,
          amount: -totalCost,
          date: new Date().toISOString(),
          type: 'OrderCost',
          note: `Order for ${targetDate}`,
        });
      }

      const personData = await tx.select({ balance: persons.balance }).from(persons).where(eq(persons.id, personId));
      const hasUnspecifiedPrices = orderLines.some(line => line.unitPrice === null);
      if (!hasUnspecifiedPrices && personData.length > 0 && personData[0].balance >= 0) {
        await tx.update(orders).set({ isSettled: true }).where(eq(orders.id, orderId));
      }
    });
  },

  updateOrder: async (orderId: string, personId: string, newOrderLines: { itemId: string, quantity: number, unitPrice: number | null }[], deliveryPlace?: string | null) => {
    const orderInfo = await db.select({ date: orders.targetDate }).from(orders).where(eq(orders.id, orderId));
    const targetDate = orderInfo.length > 0 ? orderInfo[0].date : '';

    const oldItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    let oldTotalCost = 0;
    oldItems.forEach(oi => {
      oldTotalCost += (oi.quantity * (oi.unitPrice || 0));
    });

    let newTotalCost = 0;
    newOrderLines.forEach(line => {
      newTotalCost += (line.quantity * (line.unitPrice || 0));
    });

    const linesToInsert = newOrderLines.map(line => ({
      id: generateId(),
      orderId,
      itemId: line.itemId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    }));

    await db.transaction(async (tx) => {
      if (oldTotalCost > 0) {
        await tx.update(persons)
          .set({ balance: sql`${persons.balance} + ${oldTotalCost}` })
          .where(eq(persons.id, personId));
      }

      await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
      if (linesToInsert.length > 0) {
        await tx.insert(orderItems).values(linesToInsert);
      }

      if (newTotalCost > 0) {
        await tx.update(persons)
          .set({ balance: sql`${persons.balance} - ${newTotalCost}` })
          .where(eq(persons.id, personId));
      }

      await tx.delete(transactions).where(and(
        eq(transactions.personId, personId),
        eq(transactions.type, 'OrderCost'),
        like(transactions.note, `%${targetDate}%`)
      ));

      if (newTotalCost > 0) {
        await tx.insert(transactions).values({
          id: generateId(),
          personId,
          amount: -newTotalCost,
          date: new Date().toISOString(),
          type: 'OrderCost',
          note: `Order for ${targetDate}`,
        });
      }
      
      const now = new Date().toISOString();
      const orderUpdates: any = { modifiedAt: now };
      if (deliveryPlace !== undefined) {
        orderUpdates.deliveryPlace = deliveryPlace ? await api.resolvePlaceByNameOrAlias(deliveryPlace) : null;
      }
      await tx.update(orders).set(orderUpdates).where(eq(orders.id, orderId));

      const itemIds = Array.from(new Set(newOrderLines.map(line => line.itemId)));
      if (itemIds.length > 0) {
        await tx.update(items)
          .set({ lastOrderedAt: now })
          .where(inArray(items.id, itemIds));
      }

      const personData = await tx.select({ balance: persons.balance }).from(persons).where(eq(persons.id, personId));
      const hasUnspecifiedPrices = newOrderLines.some(line => line.unitPrice === null);
      if (!hasUnspecifiedPrices && personData.length > 0 && personData[0].balance >= 0) {
        await tx.update(orders).set({ isSettled: true }).where(eq(orders.id, orderId));
      } else {
        await tx.update(orders).set({ isSettled: false }).where(eq(orders.id, orderId));
      }
    });
  },



  receivePayment: async (personId: string, amount: number, note: string) => {
    if (amount <= 0) return;
    
    console.log(`[PAYMENT DEBUG - DB] receivePayment started for personId: ${personId}, amount: ${amount}`);
    const startTx = performance.now();
    await db.transaction(async (tx) => {
      console.log(`[PAYMENT DEBUG - DB] Transaction started`);
      
      let stepStart = performance.now();
      // 1. Record the transaction (Negative amount decreases debt)
      await tx.insert(transactions).values({
        id: generateId(),
        personId,
        amount: amount,
        date: new Date().toISOString(),
        type: 'PaymentReceived',
        note: note.trim(),
      });
      console.log(`[PAYMENT DEBUG - DB] Inserted transaction in ${(performance.now() - stepStart).toFixed(2)}ms`);
      
      stepStart = performance.now();
      // 2. Update the balance
      await tx.update(persons)
        .set({ balance: sql`${persons.balance} + ${amount}` })
        .where(eq(persons.id, personId));
      console.log(`[PAYMENT DEBUG - DB] Updated person balance in ${(performance.now() - stepStart).toFixed(2)}ms`);
    });
    console.log(`[PAYMENT DEBUG - DB] Transaction finished in ${(performance.now() - startTx).toFixed(2)}ms`);
  },

  changeBalance: async (personId: string, amount: number, note: string) => {
    await db.update(persons)
      .set({ balance: sql`${persons.balance} + ${amount}` })
      .where(eq(persons.id, personId));
      
    await db.insert(transactions).values({
      id: generateId(),
      personId,
      amount,
      date: new Date().toISOString(),
      type: 'ManualAdjustment',
      note: note.trim(),
    });
  },

  settleBalance: async (personId: string, amount: number, note: string) => {
    return api.changeBalance(personId, amount, note);
  },
  
  updateItem: async (id: string, updates: Partial<{ name: string; description: string | null; defaultPrice: number | null; source: string | null; timing: 'Fresh' | 'Anytime', aliases: string[], pricePromptAlways: boolean }>, isCorrection: boolean = false) => {
    let finalSource = updates.source !== undefined ? (updates.source ? await api.resolveSourceByNameOrAlias(updates.source) : null) : undefined;
    
    const { aliases, ...itemUpdates } = updates;
    const finalUpdates: any = { ...itemUpdates };
    
    if (finalSource !== undefined) finalUpdates.source = finalSource;
    if (updates.name) finalUpdates.name = updates.name.trim();
    if (updates.description !== undefined) finalUpdates.description = updates.description?.trim() || null;

    // Fetch data for log and logic before update
    const oldItem = await db.select({ name: items.name, defaultPrice: items.defaultPrice }).from(items).where(eq(items.id, id));
    const itemName = oldItem.length > 0 ? oldItem[0].name : 'Item';
    const oldItemPrice = oldItem.length > 0 ? oldItem[0].defaultPrice : null;

    await db.transaction(async (tx) => {
      if (Object.keys(finalUpdates).length > 0) {
        await tx.update(items).set(finalUpdates).where(eq(items.id, id));
      }

      if (aliases !== undefined) {
        await tx.delete(itemAliases).where(eq(itemAliases.itemId, id));
        const aliasValues = aliases
          .map(a => a.trim())
          .filter(a => a.length > 0)
          .map(a => ({ id: generateId(), itemId: id, alias: a }));
        if (aliasValues.length > 0) {
          await tx.insert(itemAliases).values(aliasValues);
        }
      }

      if (updates.defaultPrice !== undefined) {
        const newPrice = updates.defaultPrice;
        if (isCorrection && newPrice !== null) {
          const allInstances = await db.select({
            oiId: orderItems.id,
            quantity: orderItems.quantity,
            unitPrice: orderItems.unitPrice,
            personId: orders.personId,
            orderId: orders.id,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .where(eq(orderItems.itemId, id));

          const orderIds = Array.from(new Set(allInstances.map(item => item.orderId)));
          if (orderIds.length > 0) {
            await tx.update(orders).set({ modifiedAt: new Date().toISOString() }).where(inArray(orders.id, orderIds));
          }

          for (const item of allInstances) {
            if (oldItemPrice === null) {
              // INITIALIZING PRICE for the first time
              if (item.unitPrice === null) {
                await tx.update(orderItems)
                  .set({ unitPrice: newPrice })
                  .where(eq(orderItems.id, item.oiId));
                
                // The person now owes this money
                const addedDebt = newPrice * item.quantity;
                await tx.update(persons)
                  .set({ balance: sql`${persons.balance} - ${addedDebt}` })
                  .where(eq(persons.id, item.personId));

                await tx.insert(transactions).values({
                  id: generateId(),
                  personId: item.personId,
                  amount: -addedDebt,
                  date: new Date().toISOString(),
                  type: 'OrderCost',
                  note: `Price finalized for ${itemName}`,
                });
              }
            } else {
              // ACTUAL CORRECTION of an existing price
              const effectiveOldPrice = item.unitPrice ?? 0;
              const diff = (newPrice - effectiveOldPrice) * item.quantity;

              if (diff !== 0) {
                await tx.update(orderItems)
                  .set({ unitPrice: newPrice })
                  .where(eq(orderItems.id, item.oiId));

                await tx.update(persons)
                  .set({ balance: sql`${persons.balance} - ${diff}` })
                  .where(eq(persons.id, item.personId));

                await tx.insert(transactions).values({
                  id: generateId(),
                  personId: item.personId,
                  amount: -diff,
                  date: new Date().toISOString(),
                  type: 'ManualAdjustment',
                  note: `Price correction for ${itemName}: $${effectiveOldPrice} -> $${newPrice}`,
                });
              }
            }
          }
        } else if (newPrice !== null) {
          // MARKET CHANGE (Default)
          // Only updates items that have NO price set yet (Unknown Price items)
          const pendingItems = await db.select({
            oiId: orderItems.id,
            quantity: orderItems.quantity,
            personId: orders.personId,
            orderId: orders.id,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .where(and(
            eq(orderItems.itemId, id),
            sql`${orderItems.unitPrice} IS NULL`
          ));

          const orderIds = Array.from(new Set(pendingItems.map(item => item.orderId)));
          if (orderIds.length > 0) {
            await tx.update(orders).set({ modifiedAt: new Date().toISOString() }).where(inArray(orders.id, orderIds));
          }

          for (const item of pendingItems) {
            await tx.update(orderItems)
              .set({ unitPrice: newPrice })
              .where(eq(orderItems.id, item.oiId));

            const addedDebt = newPrice * item.quantity;
            await tx.update(persons)
              .set({ balance: sql`${persons.balance} - ${addedDebt}` })
              .where(eq(persons.id, item.personId));

            await tx.insert(transactions).values({
              id: generateId(),
              personId: item.personId,
              amount: -addedDebt,
              date: new Date().toISOString(),
              type: 'OrderCost',
              note: `Price finalized for ${itemName}`,
            });
          }
        }
      }
    });
  },

  getTransactionsForPerson: async (personId: string) => {
    return db.select().from(transactions).where(eq(transactions.personId, personId)).orderBy(sql`${transactions.date} DESC`);
  },

  getUnpaidUnknownPriceItems: async (personId: string) => {
    const rows = await db.select({
      itemName: items.name,
      quantity: orderItems.quantity,
      orderDate: orders.targetDate,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(items, eq(orderItems.itemId, items.id))
    .where(and(
      eq(orders.personId, personId),
      sql`${orderItems.unitPrice} IS NULL`
    ));
    return rows;
  },

  getTopItemsForPerson: async (personId: string) => {
    // Efficiently fetch top 10 items for a person using COUNT and GROUP BY
    const res = await db.select({
      itemId: orderItems.itemId,
      count: sql<number>`count(*)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(eq(orders.personId, personId))
    .groupBy(orderItems.itemId)
    .orderBy(sql`count(*) DESC`)
    .limit(10);
    
    if (res.length === 0) return [];
    
    const itemIds = res.map(r => r.itemId);
    return db.select().from(items).where(inArray(items.id, itemIds));
  },

  getDistinctSources: async () => {
    const res = await db.selectDistinct({ source: items.source }).from(items);
    const aliasRes = await db.selectDistinct({ alias: sourceAliases.alias }).from(sourceAliases);
    
    const all = new Set([
      ...res.map(r => r.source).filter((s): s is string => s !== null && s.trim() !== ''),
      ...aliasRes.map(r => r.alias).filter((s): s is string => s !== null && s.trim() !== '')
    ]);
    return Array.from(all);
  },

  getDistinctPlaces: async (): Promise<string[]> => {
    const personPlaces = await db
      .selectDistinct({ place: persons.typicalPlace })
      .from(persons)
      .where(sql`${persons.typicalPlace} IS NOT NULL AND ${persons.typicalPlace} != ''`);
    
    const orderPlaces = await db
      .selectDistinct({ place: orders.deliveryPlace })
      .from(orders)
      .where(sql`${orders.deliveryPlace} IS NOT NULL AND ${orders.deliveryPlace} != ''`);

    const aliasPlaces = await db
      .selectDistinct({ alias: placeAliases.alias })
      .from(placeAliases);

    const all = new Set([
      ...personPlaces.map(r => r.place).filter((s): s is string => s !== null),
      ...orderPlaces.map(r => r.place).filter((s): s is string => s !== null),
      ...aliasPlaces.map(r => r.alias).filter((s): s is string => s !== null),
    ]);
    
    return Array.from(all);
  },

  addTask: async (
    title: string,
    type: 'physical_give' | 'physical_take' | 'meetup_task' | 'general_task',
    personId?: string | null,
    targetDate?: string | null,
    targetTime?: string | null,
    locationPlace?: string | null
  ) => {
    const id = generateId();
    let finalLocation = locationPlace;
    if (!finalLocation && personId) {
      const person = await db.select({ place: persons.typicalPlace }).from(persons).where(eq(persons.id, personId));
      if (person.length > 0) finalLocation = person[0].place;
    }

    const notificationId = await scheduleTaskNotification(id, title, targetDate || null, targetTime || null);

    await db.insert(tasks).values({
      id,
      title: title.trim(),
      type,
      personId: personId || null,
      targetDate: targetDate || null,
      targetTime: targetTime || null,
      locationPlace: finalLocation || null,
      notificationId,
    });
  },

  updateTask: async (
    id: string,
    updates: Partial<{
      title: string;
      type: 'physical_give' | 'physical_take' | 'meetup_task' | 'general_task';
      personId: string | null;
      targetDate: string | null;
      targetTime: string | null;
      locationPlace: string | null;
      isCompleted: boolean;
    }>
  ) => {
    const taskRows = await db.select().from(tasks).where(eq(tasks.id, id));
    if (taskRows.length === 0) return;
    const task = taskRows[0];

    const finalUpdates: any = { ...updates };
    
    // Manage Notifications
    if (updates.targetDate !== undefined || updates.targetTime !== undefined || updates.isCompleted !== undefined || updates.title !== undefined) {
      await cancelTaskNotification(task.notificationId);
      finalUpdates.notificationId = null;

      const newIsCompleted = updates.isCompleted !== undefined ? updates.isCompleted : task.isCompleted;
      
      if (!newIsCompleted) {
        const newTitle = updates.title !== undefined ? updates.title : task.title;
        const newDate = updates.targetDate !== undefined ? updates.targetDate : task.targetDate;
        const newTime = updates.targetTime !== undefined ? updates.targetTime : task.targetTime;
        
        finalUpdates.notificationId = await scheduleTaskNotification(id, newTitle, newDate, newTime);
      }
    }

    if (updates.title) finalUpdates.title = updates.title.trim();

    await db.update(tasks).set(finalUpdates).where(eq(tasks.id, id));
  },

  deleteTask: async (id: string) => {
    const taskRows = await db.select().from(tasks).where(eq(tasks.id, id));
    if (taskRows.length > 0) {
      await cancelTaskNotification(taskRows[0].notificationId);
      await db.delete(tasks).where(eq(tasks.id, id));
    }
  },

  completeTask: async (id: string, isCompleted: boolean) => {
    await api.updateTask(id, { isCompleted });
  },

  getAllData: async () => {
    return {
      version: CURRENT_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      data: {
        persons: await db.select().from(persons),
        personAliases: await db.select().from(personAliases),
        items: await db.select().from(items),
        itemAliases: await db.select().from(itemAliases),
        orders: await db.select().from(orders),
        orderItems: await db.select().from(orderItems),
        transactions: await db.select().from(transactions),
        placeAliases: await db.select().from(placeAliases),
        sourceAliases: await db.select().from(sourceAliases),
        tasks: await db.select().from(tasks),
      }
    };
  },

  importData: async (importObj: any, strategy: 'replace' | 'skip') => {
    if (!importObj || importObj.version === undefined) {
      throw new Error('Invalid export file format.');
    }
    if (importObj.version > CURRENT_SCHEMA_VERSION) {
      throw new Error('Export file is from a newer version of the app. Please update the app.');
    }

    const { data } = importObj;
    
    // --- 1. IMPORT PERSONS ---
    const personIdMap: Record<string, string> = {}; // Old ID -> New/Existing ID
    for (const p of (data.persons || [])) {
      const existing = await db.select().from(persons).where(sql`lower(name) = lower(${p.name})`);
      if (existing.length > 0) {
        personIdMap[p.id] = existing[0].id;
        if (strategy === 'replace') {
          await db.update(persons).set({
            typicalPlace: p.typicalPlace,
            balance: p.balance
          }).where(eq(persons.id, existing[0].id));
        }
      } else {
        const newId = generateId();
        await db.insert(persons).values({
          id: newId,
          name: p.name,
          typicalPlace: p.typicalPlace,
          balance: p.balance,
          createdAt: p.createdAt // Preserved if exists (Version 2+), otherwise default handles it
        });
        personIdMap[p.id] = newId;
      }
    }

    // --- 2. IMPORT ITEMS ---
    const itemIdMap: Record<string, string> = {}; // Old ID -> New/Existing ID
    for (const i of (data.items || [])) {
      const existing = await db.select().from(items).where(sql`lower(name) = lower(${i.name})`);
      if (existing.length > 0) {
        itemIdMap[i.id] = existing[0].id;
        if (strategy === 'replace') {
          await db.update(items).set({
            description: i.description,
            defaultPrice: i.defaultPrice,
            source: i.source,
            timing: i.timing,
            pricePromptAlways: i.pricePromptAlways ?? false,
            lastOrderedAt: i.lastOrderedAt || null
          }).where(eq(items.id, existing[0].id));
        }
      } else {
        const newId = generateId();
        await db.insert(items).values({
          id: newId,
          name: i.name,
          description: i.description,
          defaultPrice: i.defaultPrice,
          source: i.source,
          timing: i.timing,
          pricePromptAlways: i.pricePromptAlways ?? false,
          createdAt: i.createdAt,
          lastOrderedAt: i.lastOrderedAt || null
        });
        itemIdMap[i.id] = newId;
      }
    }

    // --- 3. IMPORT ALIASES ---
    if (data.personAliases) {
      for (const pa of data.personAliases) {
        const newPersonId = personIdMap[pa.personId];
        if (!newPersonId) continue;
        const existing = await db.select().from(personAliases).where(and(eq(personAliases.personId, newPersonId), sql`lower(alias) = lower(${pa.alias})`));
        if (existing.length === 0) {
          await db.insert(personAliases).values({ id: generateId(), personId: newPersonId, alias: pa.alias });
        }
      }
    }
    if (data.itemAliases) {
      for (const ia of data.itemAliases) {
        const newItemId = itemIdMap[ia.itemId];
        if (!newItemId) continue;
        const existing = await db.select().from(itemAliases).where(and(eq(itemAliases.itemId, newItemId), sql`lower(alias) = lower(${ia.alias})`));
        if (existing.length === 0) {
          await db.insert(itemAliases).values({ id: generateId(), itemId: newItemId, alias: ia.alias });
        }
      }
    }
    if (data.placeAliases) {
      for (const pla of data.placeAliases) {
        const existing = await db.select().from(placeAliases).where(and(eq(placeAliases.placeName, pla.placeName), sql`lower(alias) = lower(${pla.alias})`));
        if (existing.length === 0) {
          await db.insert(placeAliases).values({ id: generateId(), placeName: pla.placeName, alias: pla.alias, createdAt: pla.createdAt });
        }
      }
    }
    if (data.sourceAliases) {
      for (const sa of data.sourceAliases) {
        const existing = await db.select().from(sourceAliases).where(and(eq(sourceAliases.sourceName, sa.sourceName), sql`lower(alias) = lower(${sa.alias})`));
        if (existing.length === 0) {
          await db.insert(sourceAliases).values({ id: generateId(), sourceName: sa.sourceName, alias: sa.alias, createdAt: sa.createdAt });
        }
      }
    }
    
    // --- 4. IMPORT TASKS ---
    if (data.tasks) {
      for (const t of data.tasks) {
        const existing = await db.select().from(tasks).where(eq(tasks.id, t.id));
        let pId = t.personId;
        if (pId && personIdMap[pId]) pId = personIdMap[pId];
        
        if (existing.length === 0) {
          await db.insert(tasks).values({
            id: t.id,
            title: t.title,
            type: t.type,
            personId: pId,
            targetDate: t.targetDate,
            targetTime: t.targetTime,
            locationPlace: t.locationPlace,
            notificationId: t.notificationId,
            isCompleted: t.isCompleted,
            createdAt: t.createdAt
          });
        }
      }
    }

    // --- 5. IMPORT ORDERS ---
    for (const o of (data.orders || [])) {
      const newPersonId = personIdMap[o.personId];
      if (!newPersonId) continue;
      
      const existing = await db.select().from(orders).where(and(eq(orders.personId, newPersonId), eq(orders.targetDate, o.targetDate)));
      if (existing.length > 0) {
        if (strategy === 'replace') {
          await db.delete(orderItems).where(eq(orderItems.orderId, existing[0].id));
          await db.update(orders).set({
            deliveryPlace: o.deliveryPlace,
            isSettled: o.isSettled,
            createdAt: o.createdAt || (existing[0] as any).createdAt,
            modifiedAt: o.modifiedAt || null
          }).where(eq(orders.id, existing[0].id));
          
          const itemsForThisOrder = (data.orderItems || []).filter((oi: any) => oi.orderId === o.id);
          for (const oi of itemsForThisOrder) {
            const newItemId = itemIdMap[oi.itemId];
            if (!newItemId) continue;
            await db.insert(orderItems).values({
              id: generateId(),
              orderId: existing[0].id,
              itemId: newItemId,
              quantity: oi.quantity,
              unitPrice: oi.unitPrice,
            });
          }
        }
      } else {
        const newOrderId = generateId();
        await db.insert(orders).values({
          id: newOrderId,
          personId: newPersonId,
          targetDate: o.targetDate,
          deliveryPlace: o.deliveryPlace,
          isSettled: o.isSettled,
          createdAt: o.createdAt || new Date().toISOString(),
          modifiedAt: o.modifiedAt || null
        });
        
        const itemsForThisOrder = (data.orderItems || []).filter((oi: any) => oi.orderId === o.id);
        for (const oi of itemsForThisOrder) {
          const newItemId = itemIdMap[oi.itemId];
          if (!newItemId) continue;
          await db.insert(orderItems).values({
            id: generateId(),
            orderId: newOrderId,
            itemId: newItemId,
            quantity: oi.quantity,
            unitPrice: oi.unitPrice,
          });
        }
      }
    }

    // --- 5. IMPORT TRANSACTIONS ---
    for (const t of (data.transactions || [])) {
      const newPersonId = personIdMap[t.personId];
      if (!newPersonId) continue;
      
      const existing = await db.select().from(transactions).where(and(
        eq(transactions.personId, newPersonId),
        eq(transactions.amount, t.amount),
        eq(transactions.date, t.date),
        eq(transactions.type, t.type)
      ));
      
      if (existing.length === 0) {
        await db.insert(transactions).values({
          id: generateId(),
          personId: newPersonId,
          amount: t.amount,
          date: t.date,
          type: t.type,
          note: t.note
        });
      }
    }
  },

  deletePerson: async (id: string) => {
    await db.delete(transactions).where(eq(transactions.personId, id));
    const personOrders = await db.select({ id: orders.id }).from(orders).where(eq(orders.personId, id));
    for (const order of personOrders) {
      await api.deleteOrder(order.id);
    }
    await db.delete(persons).where(eq(persons.id, id));
  },

  deleteItem: async (id: string) => {
    await db.delete(itemAliases).where(eq(itemAliases.itemId, id));
    await db.delete(items).where(eq(items.id, id));
  },

  updatePlace: async (oldName: string, newName: string, aliases?: string[]) => {
    await db.update(persons).set({ typicalPlace: newName }).where(eq(persons.typicalPlace, oldName));
    await db.update(orders).set({ deliveryPlace: newName }).where(eq(orders.deliveryPlace, oldName));
    await db.update(placeAliases).set({ placeName: newName }).where(eq(placeAliases.placeName, oldName));

    if (aliases !== undefined) {
      await db.delete(placeAliases).where(eq(placeAliases.placeName, newName));
      const aliasValues = aliases
        .map(a => a.trim())
        .filter(a => a.length > 0)
        .map(a => ({ id: generateId(), placeName: newName, alias: a }));
      if (aliasValues.length > 0) {
        await db.insert(placeAliases).values(aliasValues);
      }
    }
  },

  updateSource: async (oldName: string, newName: string, aliases?: string[]) => {
    await db.update(items).set({ source: newName }).where(eq(items.source, oldName));
    await db.update(sourceAliases).set({ sourceName: newName }).where(eq(sourceAliases.sourceName, oldName));

    if (aliases !== undefined) {
      await db.delete(sourceAliases).where(eq(sourceAliases.sourceName, newName));
      const aliasValues = aliases
        .map(a => a.trim())
        .filter(a => a.length > 0)
        .map(a => ({ id: generateId(), sourceName: newName, alias: a }));
      if (aliasValues.length > 0) {
        await db.insert(sourceAliases).values(aliasValues);
      }
    }
  },

  deletePlace: async (name: string) => {
    await db.update(persons).set({ typicalPlace: null }).where(eq(persons.typicalPlace, name));
    await db.update(orders).set({ deliveryPlace: null }).where(eq(orders.deliveryPlace, name));
    await db.delete(placeAliases).where(eq(placeAliases.placeName, name));
  },

  deleteSource: async (name: string) => {
    await db.update(items).set({ source: null }).where(eq(items.source, name));
    await db.delete(sourceAliases).where(eq(sourceAliases.sourceName, name));
  },

  markOrderSettled: async (orderId: string, isSettled: boolean) => {
    return await db.update(orders)
      .set({ isSettled, modifiedAt: new Date().toISOString() })
      .where(eq(orders.id, orderId));
  },

  markPastOrdersSettled: async (personId: string, upToDate: string) => {
    return await db.update(orders)
      .set({ isSettled: true, modifiedAt: new Date().toISOString() })
      .where(and(
        eq(orders.personId, personId),
        lte(orders.targetDate, upToDate)
      ));
  },

  deleteOrder: async (orderId: string, revertCash: boolean = false) => {
    // 1. Get order info to know personId and targetDate
    const orderInfo = await db.select().from(orders).where(eq(orders.id, orderId));
    if (orderInfo.length === 0) return;
    const { personId, targetDate } = orderInfo[0];

    // 2. Get ALL items to revert debt (both paid and unpaid)
    const itemsList = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    let totalCost = 0;
    itemsList.forEach(oi => {
      totalCost += (oi.quantity * (oi.unitPrice || 0));
    });

    // 3. Revert balance (decrease debt because order is deleted)
    if (totalCost > 0) {
      await db.update(persons)
        .set({ balance: sql`${persons.balance} - ${totalCost}` })
        .where(eq(persons.id, personId));
    }

    // 4. If revertCash is true, find any PaymentReceived transactions and subtract them
    // This happens if the runner physically returns the cash to the person.
    if (revertCash) {
      const orderDate = targetDate;
      const targetNote = `Settled entire order from ${orderDate}`;
      
      // Find the specific bulk payment transaction if it exists
      const recentTx = await db.select({ id: transactions.id, amount: transactions.amount })
        .from(transactions)
        .where(and(
          eq(transactions.personId, personId),
          eq(transactions.type, 'PaymentReceived'),
          eq(transactions.note, targetNote)
        ))
        .orderBy(sql`${transactions.date} DESC`)
        .limit(1);

      if (recentTx.length > 0) {
        await db.update(persons)
          .set({ balance: sql`${persons.balance} - ${recentTx[0].amount}` })
          .where(eq(persons.id, personId));
        await db.delete(transactions).where(eq(transactions.id, recentTx[0].id));
      }

      // Also look for individual item payments
      // We'll search for any PaymentReceived for this person on this date
      // (This is a bit broad but consistent with how we note individual items)
      // Note: individual items are noted as "Paid: 2x Milk" etc.
      // Since we don't have a direct link, we'll rely on the bulk payment check mostly,
      // but let's try to find individual ones too if we want to be thorough.
    }

    // 5. Delete related OrderCost transactions
    await db.delete(transactions).where(and(
      eq(transactions.personId, personId),
      eq(transactions.type, 'OrderCost'),
      like(transactions.note, `%${targetDate}%`)
    ));

    // 6. Delete order items and the order itself
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await db.delete(orders).where(eq(orders.id, orderId));
  },

  moveOrdersToDate: async (orderIds: string[], newDate: string) => {
    for (const orderId of orderIds) {
      const orderInfo = await db.select().from(orders).where(eq(orders.id, orderId));
      if (orderInfo.length === 0) continue;
      const { personId, targetDate } = orderInfo[0];

      // Update the date in the order record
      await db.update(orders).set({ targetDate: newDate }).where(eq(orders.id, orderId));

      // Find the related transaction(s) and update its note to reflect the new date
      const relatedLogs = await db.select().from(transactions).where(and(
        eq(transactions.personId, personId),
        eq(transactions.type, 'OrderCost'),
        like(transactions.note, `%${targetDate}%`)
      ));

      for (const log of relatedLogs) {
        if (log.note) {
          const newNote = log.note.replace(targetDate, newDate);
          await db.update(transactions).set({ note: newNote }).where(eq(transactions.id, log.id));
        }
      }
    }
  },

  mergePersons: async (primaryId: string, secondaryId: string, keepSecondaryAsAlias: boolean) => {
    await db.update(orders).set({ personId: primaryId }).where(eq(orders.personId, secondaryId));
    await db.update(transactions).set({ personId: primaryId }).where(eq(transactions.personId, secondaryId));
    
    const secondaryPerson = await db.select().from(persons).where(eq(persons.id, secondaryId));
    
    if (secondaryPerson.length > 0) {
      await db.update(persons).set({ balance: sql`${persons.balance} + ${secondaryPerson[0].balance}` }).where(eq(persons.id, primaryId));
      if (keepSecondaryAsAlias) {
        await db.insert(personAliases).values({ id: generateId(), personId: primaryId, alias: secondaryPerson[0].name });
      }
    }

    await db.update(personAliases).set({ personId: primaryId }).where(eq(personAliases.personId, secondaryId));
    await db.delete(persons).where(eq(persons.id, secondaryId));
  },

  mergeItems: async (primaryId: string, secondaryId: string, keepSecondaryAsAlias: boolean) => {
    await db.update(orderItems).set({ itemId: primaryId }).where(eq(orderItems.itemId, secondaryId));

    const secondaryItem = await db.select().from(items).where(eq(items.id, secondaryId));
    if (secondaryItem.length > 0 && keepSecondaryAsAlias) {
      await db.insert(itemAliases).values({ id: generateId(), itemId: primaryId, alias: secondaryItem[0].name });
    }

    await db.update(itemAliases).set({ itemId: primaryId }).where(eq(itemAliases.itemId, secondaryId));
    await db.delete(items).where(eq(items.id, secondaryId));
  },

  mergePlaces: async (primaryName: string, secondaryName: string, keepSecondaryAsAlias: boolean) => {
    await db.update(persons).set({ typicalPlace: primaryName }).where(eq(persons.typicalPlace, secondaryName));
    await db.update(orders).set({ deliveryPlace: primaryName }).where(eq(orders.deliveryPlace, secondaryName));

    if (keepSecondaryAsAlias) {
      await db.insert(placeAliases).values({ id: generateId(), placeName: primaryName, alias: secondaryName });
    }

    await db.update(placeAliases).set({ placeName: primaryName }).where(eq(placeAliases.placeName, secondaryName));
    await db.delete(placeAliases).where(eq(placeAliases.placeName, secondaryName)); // remove any redundant self aliases if exist
  },

  mergeSources: async (primaryName: string, secondaryName: string, keepSecondaryAsAlias: boolean) => {
    await db.update(items).set({ source: primaryName }).where(eq(items.source, secondaryName));

    if (keepSecondaryAsAlias) {
      await db.insert(sourceAliases).values({ id: generateId(), sourceName: primaryName, alias: secondaryName });
    }

    await db.update(sourceAliases).set({ sourceName: primaryName }).where(eq(sourceAliases.sourceName, secondaryName));
    await db.delete(sourceAliases).where(eq(sourceAliases.sourceName, secondaryName));
  },

  seedDummyData: async (options: { peopleCount: number, itemsCount: number, seedOrders: boolean }) => {
    const { peopleCount, itemsCount, seedOrders } = options;

    const realItemNames = [
      'Milk', 'Bread', 'Eggs', 'Tomato', 'Cucumber', 'Apple', 'Banana', 'Chicken', 'Beef', 'Rice', 
      'Pasta', 'Salt', 'Sugar', 'Tea', 'Coffee', 'Water', 'Juice', 'Yogurt', 'Cheese', 'Butter',
      'Flour', 'Oil', 'Onion', 'Garlic', 'Potato', 'Carrot', 'Pepper', 'Lemon', 'Orange', 'Strawberry'
    ];
    const realPeopleNames = [
      'Ahmed', 'Mohamed', 'Sayed', 'Youssef', 'Ibrahim', 'Ali', 'Hassan', 'Hussein', 'Omar', 'Zainab', 
      'Fatima', 'Mariam', 'Aya', 'Nour', 'Sara', 'Mona', 'Layla', 'Hend', 'Amira', 'Khaled'
    ];

    const sources = ['Supermarket', 'Bakery', 'Farm', 'Market', 'Butcher'];
    const timings: ('Fresh' | 'Anytime')[] = ['Fresh', 'Anytime'];

    // 1. Create dummy items
    const dummyItems = [];
    for (let i = 0; i < itemsCount; i++) {
      const name = realItemNames[i % realItemNames.length] + (i >= realItemNames.length ? ` ${Math.floor(i / realItemNames.length)}` : '');
      const hasPrice = Math.random() > 0.2; // 80% have prices
      dummyItems.push({
        id: generateId(),
        name,
        source: sources[Math.floor(Math.random() * sources.length)],
        defaultPrice: hasPrice ? parseFloat((Math.random() * 10 + 1).toFixed(2)) : null,
        timing: timings[Math.floor(Math.random() * timings.length)],
      });
    }
    if (dummyItems.length > 0) {
      await db.insert(items).values(dummyItems);
    }

    // 2. Create dummy people
    const places = ['Rehab', 'Madinaty', 'Tagamoa', 'Shorouk'];
    const dummyPeople = [];
    for (let i = 0; i < peopleCount; i++) {
      const name = realPeopleNames[i % realPeopleNames.length] + (i >= realPeopleNames.length ? ` ${Math.floor(i / realPeopleNames.length)}` : '');
      dummyPeople.push({
        id: generateId(),
        name,
        balance: 0,
        typicalPlace: places[Math.floor(Math.random() * places.length)],
      });
    }
    if (dummyPeople.length > 0) {
      await db.insert(persons).values(dummyPeople);
    }

    // 3. Create dummy orders if requested
    if (seedOrders && dummyPeople.length > 0 && dummyItems.length > 0) {
      const targetDate = new Date().toISOString().split('T')[0];
      for (const person of dummyPeople) {
        const orderId = generateId();
        await db.insert(orders).values({
          id: orderId,
          personId: person.id,
          targetDate,
          isSettled: false,
          deliveryPlace: person.typicalPlace,
        });

        // Add 1-3 random items to the order
        const orderSize = Math.floor(Math.random() * 3) + 1;
        let totalCost = 0;
        for (let i = 0; i < orderSize; i++) {
          const item = dummyItems[Math.floor(Math.random() * dummyItems.length)];
          const quantity = Math.floor(Math.random() * 3) + 1;
          
          // Use item's default price if it has one
          const unitPrice = item.defaultPrice;
          const cost = quantity * (unitPrice || 0);
          totalCost += cost;
          
          await db.insert(orderItems).values({
            id: generateId(),
            orderId,
            itemId: item.id,
            quantity,
            unitPrice,
          });
        }

        // Update person balance and log transaction
        if (totalCost > 0) {
          await db.update(persons)
            .set({ balance: sql`${persons.balance} + ${totalCost}` })
            .where(eq(persons.id, person.id));

          await db.insert(transactions).values({
            id: generateId(),
            personId: person.id,
            amount: totalCost,
            date: new Date().toISOString(),
            type: 'OrderCost',
            note: `Order for ${targetDate}`,
          });
        }
      }
    }
  },

  wipeAllData: async () => {
    await db.transaction(async (tx) => {
      // Using where(sql`1=1`) to ensure reactive hooks trigger correctly on all platforms
      await tx.delete(transactions).where(sql`1=1`);
      await tx.delete(orderItems).where(sql`1=1`);
      await tx.delete(orders).where(sql`1=1`);
      await tx.delete(personAliases).where(sql`1=1`);
      await tx.delete(persons).where(sql`1=1`);
      await tx.delete(itemAliases).where(sql`1=1`);
      await tx.delete(items).where(sql`1=1`);
      await tx.delete(placeAliases).where(sql`1=1`);
      await tx.delete(sourceAliases).where(sql`1=1`);
    });
  },
};
