import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View, I18nManager, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput } from './Themed';
import { db } from '@/db';
import { orders, orderItems, items } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { ACCENT_GOLD, LIGHT_GOLD } from '@/constants/Colors';
import { useSettings } from '@/utils/settings';
import { useTranslation } from '@/utils/i18n';
import { formatDateLabel, formatDateTime } from '@/utils/dates';

interface PersonOrdersModalProps {
  visible: boolean;
  personId: string;
  personName: string;
  onClose: () => void;
}

export default function PersonOrdersModal({ visible, personId, personName, onClose }: PersonOrdersModalProps) {
  const { settings } = useSettings();
  const { t, isRTL } = useTranslation();

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'status' | 'total' | 'modified' | 'none'>('none');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const { data: personOrders } = useLiveQuery(
    db.select()
      .from(orders)
      .where(eq(orders.personId, personId))
  );

  const { data: allOrderItems } = useLiveQuery(
    db.select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      itemId: orderItems.itemId,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      isPaid: orderItems.isPaid,
      itemName: items.name,
    })
    .from(orderItems)
    .innerJoin(items, eq(orderItems.itemId, items.id))
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(eq(orders.personId, personId))
  );

  const processedOrders = useMemo(() => {
    if (!personOrders) return [];

    const orderList = personOrders.map(order => {
      const itemsForOrder = allOrderItems?.filter(oi => oi.orderId === order.id) || [];
      const totalCost = itemsForOrder.reduce((sum, i) => sum + (i.unitPrice ?? 0) * i.quantity, 0);
      const isFullyPaid = itemsForOrder.length > 0 && itemsForOrder.every(i => i.isPaid);
      const hasUnknownPrices = itemsForOrder.some(i => i.unitPrice === null);
      
      return {
        ...order,
        items: itemsForOrder,
        totalCost,
        isFullyPaid,
        hasUnknownPrices,
      };
    });

    // Filtering
    const q = searchQuery.toLowerCase().trim();
    let filtered = orderList;
    if (q) {
      filtered = orderList.filter(o => {
        const itemNames = o.items.map(i => i.itemName.toLowerCase()).join(' ');
        const dateStr = o.targetDate.toLowerCase();
        return itemNames.includes(q) || dateStr.includes(q);
      });
    }

    // Sorting
    if (sortBy !== 'none') {
      filtered.sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'date') {
          comparison = a.targetDate.localeCompare(b.targetDate);
        } else if (sortBy === 'status') {
          comparison = (a.isFullyPaid ? 1 : 0) - (b.isFullyPaid ? 1 : 0);
        } else if (sortBy === 'total') {
          comparison = a.totalCost - b.totalCost;
        } else if (sortBy === 'modified') {
          // Fallback to createdAt if modifiedAt is null/empty
          // @ts-ignore
          const dateA = a.modifiedAt || a.createdAt || '';
          // @ts-ignore
          const dateB = b.modifiedAt || b.createdAt || '';
          comparison = dateA.localeCompare(dateB);
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
    }

    return filtered;
  }, [personOrders, allOrderItems, searchQuery, sortBy, sortOrder]);

  const toggleSort = (type: 'date' | 'status' | 'total' | 'modified') => {
    if (sortBy === type) {
      if (sortOrder === 'asc') {
        setSortOrder('desc');
      } else {
        setSortBy('none');
      }
    } else {
      setSortBy(type);
      setSortOrder('asc');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={[styles.dialog, settings.compactMode && styles.dialogCompact]}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={[styles.title, settings.compactMode && styles.titleCompact]}>
                {t('modals.personOrdersTitle', { name: personName })}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <FontAwesome name="times" size={24} color="#888" />
            </TouchableOpacity>
          </View>

          <View style={[styles.searchBar, settings.compactMode && styles.searchBarCompact]}>
            <FontAwesome name="search" size={16} color="#666" style={styles.searchIcon} />
            <TextInput
              style={[styles.searchInput, settings.compactMode && styles.searchInputCompact]}
              placeholder={t('modals.searchOrdersPlaceholder')}
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          <View style={[styles.sortRow, settings.compactMode && styles.sortRowCompact]}>
            <TouchableOpacity 
              style={[styles.sortTab, sortBy === 'date' && styles.sortTabActive]} 
              onPress={() => toggleSort('date')}
            >
              <Text style={[styles.sortTabText, sortBy === 'date' && styles.sortTabTextActive, settings.compactMode && styles.textExtraSmall]}>
                {t('people.sortAdded')}
              </Text>
              {sortBy === 'date' && (
                <FontAwesome name={sortOrder === 'asc' ? "caret-up" : "caret-down"} size={12} color="#fff" style={{ marginStart: 4 }} />
              )}
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.sortTab, sortBy === 'status' && styles.sortTabActive]} 
              onPress={() => toggleSort('status')}
            >
              <Text style={[styles.sortTabText, sortBy === 'status' && styles.sortTabTextActive, settings.compactMode && styles.textExtraSmall]}>
                {t('modals.sortStatus')}
              </Text>
              {sortBy === 'status' && (
                <FontAwesome name={sortOrder === 'asc' ? "caret-up" : "caret-down"} size={12} color="#fff" style={{ marginStart: 4 }} />
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.sortTab, sortBy === 'total' && styles.sortTabActive]} 
              onPress={() => toggleSort('total')}
            >
              <Text style={[styles.sortTabText, sortBy === 'total' && styles.sortTabTextActive, settings.compactMode && styles.textExtraSmall]}>
                {t('modals.sortTotal')}
              </Text>
              {sortBy === 'total' && (
                <FontAwesome name={sortOrder === 'asc' ? "caret-up" : "caret-down"} size={12} color="#fff" style={{ marginStart: 4 }} />
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.sortTab, sortBy === 'modified' && styles.sortTabActive]} 
              onPress={() => toggleSort('modified')}
            >
              <Text style={[styles.sortTabText, sortBy === 'modified' && styles.sortTabTextActive, settings.compactMode && styles.textExtraSmall]}>
                {t('modals.sortModified')}
              </Text>
              {sortBy === 'modified' && (
                <FontAwesome name={sortOrder === 'asc' ? "caret-up" : "caret-down"} size={12} color="#fff" style={{ marginStart: 4 }} />
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {processedOrders.map((order) => (
              <View key={order.id} style={[styles.orderCard, settings.compactMode && styles.orderCardCompact]}>
                <View style={styles.orderHeader}>
                  <View style={{ alignItems: 'flex-start', flex: 1, gap: 2 }}>
                    <Text style={[styles.orderDate, settings.compactMode && styles.textSmall]}>
                      {(() => {
                        const [y, m, d] = order.targetDate.split('-').map(Number);
                        return formatDateLabel(new Date(y, m - 1, d), t, t('modals.daysShort'));
                      })()}
                    </Text>
                    {order.deliveryPlace && (
                      <Text style={[styles.orderPlace, settings.compactMode && styles.textExtraSmall]}>
                        📍 {order.deliveryPlace}
                      </Text>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                      <FontAwesome name="clock-o" size={settings.compactMode ? 10 : 12} color="#888" />
                      <Text style={[styles.orderCreatedAt, settings.compactMode && styles.orderCreatedAtCompact]}>
                        {" "}{t('modals.created')}: {order.createdAt ? formatDateTime(order.createdAt, settings.language || 'en') : t('modals.notAvailable')}
                      </Text>
                    </View>
                    {sortBy === 'modified' && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                        <FontAwesome name="edit" size={settings.compactMode ? 10 : 12} color="#888" />
                        <Text style={[styles.orderCreatedAt, settings.compactMode && styles.orderCreatedAtCompact]}>
                          {" "}{t('modals.modified')}: {order.modifiedAt ? formatDateTime(order.modifiedAt, settings.language || 'en') : t('modals.neverModified')}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.orderStatusRow}>
                    <View style={[styles.statusBadge, { backgroundColor: order.isFullyPaid ? '#00C851' : '#ff4444' }]}>
                      <Text style={styles.statusText}>
                        {order.isFullyPaid ? t('modals.paid') : t('modals.unpaid')}
                      </Text>
                    </View>
                    <Text style={[styles.orderTotal, settings.compactMode && styles.textSmall]}>
                      ${order.totalCost.toFixed(2)}{order.hasUnknownPrices ? '+' : ''}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.orderItems}>
                  {order.items.map((item) => (
                    <View key={item.id} style={styles.itemRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, overflow: 'hidden' }}>
                        <View style={[styles.quantityBadge, settings.compactMode && styles.quantityBadgeCompact]}>
                          <Text style={[styles.quantityText, settings.compactMode && styles.quantityTextCompact]}>
                            {item.quantity}x
                          </Text>
                        </View>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.itemText, settings.compactMode && styles.textExtraSmall, { flexShrink: 1 }]}>
                          {isRTL ? '\u200F' : ''}{item.itemName}
                        </Text>
                      </View>
                      <View style={[styles.priceBadge, { marginStart: 10 }]}>
                        <Text style={[styles.itemPrice, settings.compactMode && styles.textExtraSmall]}>
                          {item.unitPrice !== null ? `$${(item.unitPrice * item.quantity).toFixed(2)}` : t('common.priceTBD')}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {processedOrders.length === 0 && (
              <View style={styles.emptyContainer}>
                <FontAwesome name="file-text-o" size={40} color="#444" />
                <Text style={styles.emptyText}>{t('modals.noTransactions')}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  dialog: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '90%',
    padding: 20,
    elevation: 20,
  },
  dialogCompact: { padding: 12 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  headerLeft: { flex: 1 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  titleCompact: { fontSize: 18 },
  closeBtn: { padding: 5 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchBarCompact: { marginBottom: 8 },
  searchIcon: { marginEnd: 8 },
  searchInput: {
    flex: 1,
    height: 40,
    color: '#fff',
    fontSize: 16,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  searchInputCompact: { height: 32, fontSize: 14 },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 15,
  },
  sortRowCompact: { marginBottom: 10, gap: 6 },
  sortTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#333',
    borderWidth: 1,
    borderColor: '#444',
  },
  sortTabActive: {
    backgroundColor: ACCENT_GOLD,
    borderColor: ACCENT_GOLD,
  },
  sortTabText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
  },
  sortTabTextActive: {
    color: '#fff',
  },
  list: { flex: 1 },
  listContent: { paddingBottom: 20 },
  orderCard: {
    backgroundColor: '#262626',
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  orderCardCompact: { padding: 10, marginBottom: 8 },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 8,
  },
  orderDate: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  orderPlace: { color: LIGHT_GOLD, fontSize: 12, marginTop: 2 },
  orderCreatedAt: { color: '#888', fontSize: 12 },
  orderCreatedAtCompact: { fontSize: 10 },
  orderStatusRow: { alignItems: 'flex-end' },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  statusText: { color: '#fff', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' },
  orderTotal: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  orderItems: { gap: 4 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemText: { color: '#ccc', fontSize: 13 },
  itemPrice: { color: '#888', fontSize: 12 },
  quantityBadge: { backgroundColor: '#333', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  quantityText: { color: '#ccc', fontWeight: 'bold', fontSize: 12 },
  quantityBadgeCompact: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  quantityTextCompact: { fontSize: 10 },
  priceBadge: { backgroundColor: '#2a2a2a', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 20,
  },
  emptyText: { color: '#666', marginTop: 12, fontSize: 16, fontStyle: 'italic' },
  textSmall: { fontSize: 14 },
  textExtraSmall: { fontSize: 12 },
});
