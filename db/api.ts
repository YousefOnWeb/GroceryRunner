import { and, eq, inArray, like, sql } from 'drizzle-orm';
import * as crypto from 'expo-crypto';
import { db } from './index';
import { items, orderItems, orders, personAliases, persons, transactions, itemAliases, placeAliases, sourceAliases } from './schema';

export const generateId = () => crypto.randomUUID();
export const CURRENT_SCHEMA_VERSION = 2;

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
  
  addItem: async (name: string, defaultPrice: number | null, source: string | null, timing: 'Fresh' | 'Anytime', aliases?: string[]) => {
    const trimmed = name.trim();
    const existing = await db.select().from(items).where(sql`lower(name) = lower(${trimmed})`);
    if (existing.length > 0) return existing;
    
    let finalSource = source ? await api.resolveSourceByNameOrAlias(source) : null;

    const result = await db.insert(items).values({ id: generateId(), name: trimmed, defaultPrice, source: finalSource, timing }).returning();
    
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
    // 1. Fetch current person balance
    const person = await db.select({ balance: persons.balance }).from(persons).where(eq(persons.id, personId));
    const currentBalance = person.length > 0 ? person[0].balance : 0;

    const orderId = generateId();
    let totalCost = 0;
    
    // 2. Calculate total cost (using 0 for unknown prices)
    orderLines.forEach(line => {
      totalCost += (line.quantity * (line.unitPrice || 0));
    });

    // 3. Determine if it's auto-paid (Case A: Credit >= Cost)
    const shouldAutoPay = totalCost > 0 && currentBalance >= totalCost;

    const linesToInsert = orderLines.map(line => {
      return {
        id: generateId(),
        orderId,
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        isPaid: shouldAutoPay,
      };
    });

    let finalPlace = deliveryPlace ? await api.resolvePlaceByNameOrAlias(deliveryPlace) : null;
    const now = new Date().toISOString();

    await db.insert(orders).values({
      id: orderId,
      personId,
      targetDate,
      isPaid: shouldAutoPay,
      deliveryPlace: finalPlace,
      createdAt: now,
    });
    
    if (linesToInsert.length > 0) {
      await db.insert(orderItems).values(linesToInsert);
      
      const itemIds = Array.from(new Set(orderLines.map(line => line.itemId)));
      if (itemIds.length > 0) {
        await db.update(items)
          .set({ lastOrderedAt: now })
          .where(inArray(items.id, itemIds));
      }
    }

    if (totalCost > 0) {
      await db.update(persons)
        .set({ balance: sql`${persons.balance} - ${totalCost}` })
        .where(eq(persons.id, personId));

      await db.insert(transactions).values({
        id: generateId(),
        personId,
        amount: -totalCost,
        date: new Date().toISOString(),
        type: 'OrderCost',
        note: `Order for ${targetDate}${shouldAutoPay ? ' (Auto-settled)' : ''}`,
      });
    }
  },

  updateOrder: async (orderId: string, personId: string, newOrderLines: { itemId: string, quantity: number, unitPrice: number | null }[], deliveryPlace?: string | null) => {
    // Fetch targetDate for note
    const orderInfo = await db.select({ date: orders.targetDate }).from(orders).where(eq(orders.id, orderId));
    const targetDate = orderInfo.length > 0 ? orderInfo[0].date : '';

    // 1. Fetch ALL old items to revert their cost deduction
    const oldItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    let oldTotalCost = 0;
    oldItems.forEach(oi => {
      oldTotalCost += (oi.quantity * (oi.unitPrice || 0));
    });

    // Revert old debt (increase balance to "pre-order" state for this specific order)
    if (oldTotalCost > 0) {
      await db.update(persons)
        .set({ balance: sql`${persons.balance} + ${oldTotalCost}` })
        .where(eq(persons.id, personId));
    }

    // 2. Delete old items
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));

    // 3. Fetch current "pre-apply" balance to check for auto-settlement
    const person = await db.select({ balance: persons.balance }).from(persons).where(eq(persons.id, personId));
    const currentBalance = person.length > 0 ? person[0].balance : 0;

    // 4. Insert new items and calculate new cost
    let newTotalCost = 0;
    newOrderLines.forEach(line => {
      newTotalCost += (line.quantity * (line.unitPrice || 0));
    });

    const shouldAutoPay = newTotalCost > 0 && currentBalance >= newTotalCost;

    const linesToInsert = newOrderLines.map(line => {
      return {
        id: generateId(),
        orderId,
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        isPaid: shouldAutoPay,
      };
    });

    if (linesToInsert.length > 0) {
      await db.insert(orderItems).values(linesToInsert);
    }

    // Apply new debt (decrease balance)
    if (newTotalCost > 0) {
      await db.update(persons)
        .set({ balance: sql`${persons.balance} - ${newTotalCost}` })
        .where(eq(persons.id, personId));
    }

    // Replace old order logs with a single clean one
    await db.delete(transactions).where(and(
      eq(transactions.personId, personId),
      eq(transactions.type, 'OrderCost'),
      like(transactions.note, `%${targetDate}%`)
    ));

    if (newTotalCost > 0) {
      await db.insert(transactions).values({
        id: generateId(),
        personId,
        amount: -newTotalCost,
        date: new Date().toISOString(),
        type: 'OrderCost',
        note: `Order for ${targetDate}${shouldAutoPay ? ' (Auto-settled)' : ''}`,
      });
    }
    
    // Update deliveryPlace and set order status & modifiedAt
    const now = new Date().toISOString();
    const orderUpdates: any = { isPaid: shouldAutoPay, modifiedAt: now };
    if (deliveryPlace !== undefined) {
      orderUpdates.deliveryPlace = deliveryPlace ? await api.resolvePlaceByNameOrAlias(deliveryPlace) : null;
    }
    await db.update(orders).set(orderUpdates).where(eq(orders.id, orderId));

    // Update lastOrderedAt for items in the updated order
    const itemIds = Array.from(new Set(newOrderLines.map(line => line.itemId)));
    if (itemIds.length > 0) {
      await db.update(items)
        .set({ lastOrderedAt: now })
        .where(inArray(items.id, itemIds));
    }
  },



  markAllPaid: async (orderId: string, personId: string) => {
    const itemsToPay = await db.select().from(orderItems).where(
      and(eq(orderItems.orderId, orderId), eq(orderItems.isPaid, false))
    );
    
    const orderInfo = await db.select({ date: orders.targetDate }).from(orders).where(eq(orders.id, orderId));
    const orderDate = orderInfo.length > 0 ? orderInfo[0].date : '';

    let totalUnpaidCost = 0;
    const idsToUpdate: string[] = [];
    
    itemsToPay.forEach(oi => {
      totalUnpaidCost += (oi.quantity * (oi.unitPrice || 0));
      idsToUpdate.push(oi.id);
    });

    if (idsToUpdate.length > 0) {
      const person = await db.select({ balance: persons.balance }).from(persons).where(eq(persons.id, personId));
      const currentBalance = person.length > 0 ? person[0].balance : 0;
      
      const debt = Math.max(0, -currentBalance);
      const cashAdded = Math.min(totalUnpaidCost, debt);

      await db.update(orderItems).set({ isPaid: true }).where(inArray(orderItems.id, idsToUpdate));
      await db.update(orders).set({ isPaid: true, modifiedAt: new Date().toISOString() }).where(eq(orders.id, orderId));

      if (cashAdded > 0) {
        // Reimburse runner for cash received
        await db.update(persons)
          .set({ balance: sql`${persons.balance} + ${cashAdded}` })
          .where(eq(persons.id, personId));
          
        await db.insert(transactions).values({
          id: generateId(),
          personId,
          amount: cashAdded,
          date: new Date().toISOString(),
          type: 'PaymentReceived',
          note: `Settled entire order from ${orderDate}`,
        });
      }
    }
  },

  markOrderPaid: async (orderId: string, personId: string) => {
    return api.markAllPaid(orderId, personId);
  },

  markAllOrdersPaidSilently: async (personId: string) => {
    await db.update(orderItems)
      .set({ isPaid: true })
      .where(sql`${orderItems.orderId} IN (SELECT id FROM ${orders} WHERE personId = ${personId})`);
    await db.update(orders)
      .set({ isPaid: true, modifiedAt: new Date().toISOString() })
      .where(eq(orders.personId, personId));
  },

  markOrderUnpaid: async (orderId: string, personId: string) => {
    const itemsInOrder = await db.select().from(orderItems).where(
      and(eq(orderItems.orderId, orderId), eq(orderItems.isPaid, true))
    );
    
    const orderInfo = await db.select({ date: orders.targetDate }).from(orders).where(eq(orders.id, orderId));
    const orderDate = orderInfo.length > 0 ? orderInfo[0].date : '';
    const targetNote = `Settled entire order from ${orderDate}`;

    let totalPaidCost = 0;
    const idsToUpdate: string[] = [];
    
    itemsInOrder.forEach(oi => {
      totalPaidCost += (oi.quantity * (oi.unitPrice || 0));
      idsToUpdate.push(oi.id);
    });

    if (idsToUpdate.length > 0) {
      await db.update(orderItems).set({ isPaid: false }).where(inArray(orderItems.id, idsToUpdate));
      await db.update(orders).set({ isPaid: false, modifiedAt: new Date().toISOString() }).where(eq(orders.id, orderId));

      if (totalPaidCost > 0) {
        // Find and delete the most recent "Settled" transaction for this order
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
          // Cash payment case: revert the reimbursement (debt comes back)
          // Use the EXACT amount from the transaction
          await db.update(persons)
            .set({ balance: sql`${persons.balance} - ${recentTx[0].amount}` })
            .where(eq(persons.id, personId));
            
          await db.delete(transactions).where(eq(transactions.id, recentTx[0].id));
        }
        // If no transaction was found, it was settled using existing credit.
        // We do NOT add the balance back, maintaining the debt correctly.
      }
    }
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
  
  updateItem: async (id: string, updates: Partial<{ name: string; defaultPrice: number | null; source: string | null; timing: 'Fresh' | 'Anytime', aliases: string[] }>, isCorrection: boolean = false) => {
    let finalSource = updates.source !== undefined ? (updates.source ? await api.resolveSourceByNameOrAlias(updates.source) : null) : undefined;
    
    const { aliases, ...itemUpdates } = updates;
    const finalUpdates: any = { ...itemUpdates };
    
    if (finalSource !== undefined) finalUpdates.source = finalSource;
    if (updates.name) finalUpdates.name = updates.name.trim();

    // Fetch data for log and logic before update
    const oldItem = await db.select({ name: items.name, defaultPrice: items.defaultPrice }).from(items).where(eq(items.id, id));
    const itemName = oldItem.length > 0 ? oldItem[0].name : 'Item';
    const oldItemPrice = oldItem.length > 0 ? oldItem[0].defaultPrice : null;

    if (Object.keys(finalUpdates).length > 0) {
      await db.update(items).set(finalUpdates).where(eq(items.id, id));
    }

    if (aliases !== undefined) {
      await db.delete(itemAliases).where(eq(itemAliases.itemId, id));
      const aliasValues = aliases
        .map(a => a.trim())
        .filter(a => a.length > 0)
        .map(a => ({ id: generateId(), itemId: id, alias: a }));
      if (aliasValues.length > 0) {
        await db.insert(itemAliases).values(aliasValues);
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
          isPaid: orderItems.isPaid,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(eq(orderItems.itemId, id));

        const orderIds = Array.from(new Set(allInstances.map(item => item.orderId)));
        if (orderIds.length > 0) {
          await db.update(orders).set({ modifiedAt: new Date().toISOString() }).where(inArray(orders.id, orderIds));
        }

        for (const item of allInstances) {
          if (oldItemPrice === null) {
            // INITIALIZING PRICE for the first time
            if (item.unitPrice === null) {
              await db.update(orderItems)
                .set({ unitPrice: newPrice })
                .where(eq(orderItems.id, item.oiId));
              
              if (!item.isPaid) {
                // If it wasn't paid yet, the person now owes this money
                const addedDebt = newPrice * item.quantity;
                await db.update(persons)
                  .set({ balance: sql`${persons.balance} - ${addedDebt}` })
                  .where(eq(persons.id, item.personId));

                await db.insert(transactions).values({
                  id: generateId(),
                  personId: item.personId,
                  amount: -addedDebt,
                  date: new Date().toISOString(),
                  type: 'OrderCost',
                  note: `Price finalized for ${itemName}`,
                });
              }
              // If it WAS already paid before we knew the price, we don't adjust balance (user's "already settled" rule)
            }
          } else {
            // ACTUAL CORRECTION of an existing price
            const effectiveOldPrice = item.unitPrice ?? 0;
            const diff = (newPrice - effectiveOldPrice) * item.quantity;

            if (diff !== 0) {
              await db.update(orderItems)
                .set({ unitPrice: newPrice })
                .where(eq(orderItems.id, item.oiId));

              // For corrections, we always adjust balance (even if paid, as per user's request)
              await db.update(persons)
                .set({ balance: sql`${persons.balance} - ${diff}` })
                .where(eq(persons.id, item.personId));

              await db.insert(transactions).values({
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
          isPaid: orderItems.isPaid,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          eq(orderItems.itemId, id),
          sql`${orderItems.unitPrice} IS NULL`
        ));

        const orderIds = Array.from(new Set(pendingItems.map(item => item.orderId)));
        if (orderIds.length > 0) {
          await db.update(orders).set({ modifiedAt: new Date().toISOString() }).where(inArray(orders.id, orderIds));
        }

        for (const item of pendingItems) {
          await db.update(orderItems)
            .set({ unitPrice: newPrice })
            .where(eq(orderItems.id, item.oiId));

          if (!item.isPaid) {
            const addedDebt = newPrice * item.quantity;
            await db.update(persons)
              .set({ balance: sql`${persons.balance} - ${addedDebt}` })
              .where(eq(persons.id, item.personId));

            await db.insert(transactions).values({
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
    }
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
      eq(orderItems.isPaid, false),
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
            defaultPrice: i.defaultPrice,
            source: i.source,
            timing: i.timing,
            lastOrderedAt: i.lastOrderedAt || null
          }).where(eq(items.id, existing[0].id));
        }
      } else {
        const newId = generateId();
        await db.insert(items).values({
          id: newId,
          name: i.name,
          defaultPrice: i.defaultPrice,
          source: i.source,
          timing: i.timing,
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

    // --- 4. IMPORT ORDERS ---
    for (const o of (data.orders || [])) {
      const newPersonId = personIdMap[o.personId];
      if (!newPersonId) continue;
      
      const existing = await db.select().from(orders).where(and(eq(orders.personId, newPersonId), eq(orders.targetDate, o.targetDate)));
      if (existing.length > 0) {
        if (strategy === 'replace') {
          await db.delete(orderItems).where(eq(orderItems.orderId, existing[0].id));
          await db.update(orders).set({
            deliveryPlace: o.deliveryPlace,
            isPaid: o.isPaid,
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
              isPaid: oi.isPaid
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
          isPaid: o.isPaid,
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
            isPaid: oi.isPaid
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

    // 3. Revert balance (increase back what was charged initially)
    if (totalCost > 0) {
      await db.update(persons)
        .set({ balance: sql`${persons.balance} + ${totalCost}` })
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
          isPaid: false,
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
            isPaid: false,
          });
        }

        // Update person balance and log transaction
        if (totalCost > 0) {
          await db.update(persons)
            .set({ balance: sql`${persons.balance} - ${totalCost}` })
            .where(eq(persons.id, person.id));

          await db.insert(transactions).values({
            id: generateId(),
            personId: person.id,
            amount: -totalCost,
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
