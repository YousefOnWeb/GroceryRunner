import React, { useMemo, useState, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Keyboard, I18nManager, FlatList, View as RNView, Pressable, Animated } from 'react-native';
import { Text, View, TextInput } from '@/components/Themed';
import { db } from '@/db';
import { api } from '@/db/api';
import { orderItems, orders, personAliases, persons, items, tasks } from '@/db/schema';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { and, eq, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useSettings } from '@/utils/settings';
import { useTranslation } from '@/utils/i18n';
import { ACCENT_GOLD, LIGHT_GOLD, METALLIC_BEVEL, LIQUID_GOLD_STOPS } from '@/constants/Colors';
import { formatDateLabel, formatDateTime } from '@/utils/dates';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

// Modals
import CreditLogModal from '@/components/CreditLogModal';
import UnknownPriceModal from '@/components/UnknownPriceModal';
import PromptModal from '@/components/PromptModal';
import PersonOrdersModal from '@/components/PersonOrdersModal';
import DropdownSelect from '@/components/DropdownSelect';

export default function UnsettledScreen() {
  const router = useRouter();
  const { settings } = useSettings();
  const { t, isRTL } = useTranslation();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [groupBy, setGroupBy] = useState<'day' | 'person' | 'none'>('day');
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'name'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [refreshKey, setRefreshKey] = useState(0);

  // Modal States
  const [unknownPricePerson, setUnknownPricePerson] = useState<{ id: string; name: string } | null>(null);
  const [logPerson, setLogPerson] = useState<{ id: string; name: string } | null>(null);
  const [payAmountOrder, setPayAmountOrder] = useState<{ id: string; personId: string; total: number; personName: string; date: string } | null>(null);
  const [ordersPerson, setOrdersPerson] = useState<{ id: string; name: string } | null>(null);

  // Drizzle Queries
  const { data: allUnsettledOrders } = useLiveQuery(
    db.select().from(orders).where(eq(orders.isPaid, false))
  );

  const { data: allUnsettledOrderItems } = useLiveQuery(
    db.select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      itemId: orderItems.itemId,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      isPaid: orderItems.isPaid,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(eq(orders.isPaid, false))
  );

  const { data: catalog } = useLiveQuery(db.select().from(items));
  const { data: peopleList } = useLiveQuery(db.select().from(persons));
  const { data: allAliases } = useLiveQuery(db.select().from(personAliases));
  const { data: allIncompleteTasks } = useLiveQuery(
    db.select().from(tasks).where(eq(tasks.isCompleted, false))
  );

  // Force re-render when focused to keep relative dates updated
  useFocusEffect(
    React.useCallback(() => {
      setRefreshKey(prev => prev + 1);
    }, [])
  );

  // Map orders, calculate totals, resolve relations
  const unsettledOrdersList = useMemo(() => {
    if (!allUnsettledOrders || !allUnsettledOrderItems || !catalog || !peopleList || !allIncompleteTasks) {
      return [];
    }

    const baseList = allUnsettledOrders.map(order => {
      const person = peopleList.find(p => p.id === order.personId);
      const itemsForOrder = allUnsettledOrderItems.filter(oi => oi.orderId === order.id);

      let totalCost = 0;
      let unpaidCost = 0;
      let hasUnpaidItems = false;
      let hasUnknownPriceItems = false;

      const orderDetails = itemsForOrder.map(oi => {
        const itemDef = catalog.find(c => c.id === oi.itemId);
        const cost = (oi.unitPrice ?? 0) * oi.quantity;
        totalCost += cost;

        if (!oi.isPaid) {
          unpaidCost += cost;
          hasUnpaidItems = true;
          if (oi.unitPrice === null) hasUnknownPriceItems = true;
        }

        return { ...oi, itemDef };
      });

      return {
        order,
        person: person || { id: order.personId, name: 'Unknown Customer', balance: 0 },
        items: orderDetails,
        tasks: [] as any[],
        totalCost,
        unpaidCost,
        hasUnpaidItems,
        hasUnknownPriceItems,
        deliveryPlace: order.deliveryPlace || person?.typicalPlace || null
      };
    });

    const personTasks = allIncompleteTasks.filter(t => !!t.personId);

    personTasks.forEach(task => {
      const existingEntry = baseList.find(b => b.person.id === task.personId && b.order.targetDate === (task.targetDate || 'No Date'));
      
      if (existingEntry) {
         existingEntry.tasks.push(task);
      } else {
         const person = peopleList.find(p => p.id === task.personId);
         if (person) {
           baseList.push({
             order: { id: `task-only-${task.id}`, targetDate: task.targetDate || 'No Date', createdAt: task.createdAt, isPaid: true } as any,
             person,
             items: [],
             tasks: [task],
             totalCost: 0,
             unpaidCost: 0,
             hasUnpaidItems: false,
             hasUnknownPriceItems: false,
             deliveryPlace: task.locationPlace || person.typicalPlace || null
           });
         }
      }
    });

    return baseList;
  }, [allUnsettledOrders, allUnsettledOrderItems, catalog, peopleList, allIncompleteTasks, refreshKey]);

  // Apply search query filtering
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return unsettledOrdersList;

    return unsettledOrdersList.filter(po => {
      const aliases = allAliases?.filter(a => a.personId === po.person.id).map(a => a.alias) || [];
      const itemNames = po.items.map(i => i.itemDef?.name || '').join(' ');
      const searchString = [
        po.person.name,
        po.deliveryPlace || '',
        po.order.targetDate,
        itemNames,
        ...aliases
      ].join(' ').toLowerCase();
      return searchString.includes(q);
    });
  }, [unsettledOrdersList, allAliases, searchQuery]);

  // Apply sorting
  const sortedOrders = useMemo(() => {
    const list = [...filteredOrders];
    list.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'date') {
        comparison = a.order.targetDate.localeCompare(b.order.targetDate);
      } else if (sortBy === 'amount') {
        comparison = a.totalCost - b.totalCost;
      } else if (sortBy === 'name') {
        comparison = a.person.name.localeCompare(b.person.name);
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
    return list;
  }, [filteredOrders, sortBy, sortOrder]);

  // Calculate sum of absolute negative balances (Owed to the runner)
  const totalOutstandingOwed = useMemo(() => {
    if (!peopleList) return 0;
    return peopleList.reduce((sum, p) => {
      if (p.balance < 0) {
        return sum + Math.abs(p.balance);
      }
      return sum;
    }, 0);
  }, [peopleList]);

  // Flatten and group for FlatList data array
  const flatListData = useMemo(() => {
    const list: any[] = [];

    if (groupBy === 'day') {
      const groups: Record<string, typeof sortedOrders> = {};
      sortedOrders.forEach(po => {
        const date = po.order.targetDate;
        if (!groups[date]) groups[date] = [];
        groups[date].push(po);
      });

      const sortedDates = Object.keys(groups).sort((a, b) => {
        return sortOrder === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
      });

      sortedDates.forEach(date => {
        list.push({
          type: 'group-header',
          id: `header-day-${date}`,
          title: date,
          count: groups[date].length,
          total: groups[date].reduce((sum, po) => sum + po.totalCost, 0),
        });

        groups[date].forEach(po => {
          list.push({
            type: 'order-card',
            id: `order-${po.order.id}`,
            po,
          });
        });
      });
    } else if (groupBy === 'person') {
      const groups: Record<string, typeof sortedOrders> = {};
      sortedOrders.forEach(po => {
        const pId = po.person.id;
        if (!groups[pId]) groups[pId] = [];
        groups[pId].push(po);
      });

      const sortedPersonIds = Object.keys(groups).sort((a, b) => {
        const nameA = groups[a][0].person.name;
        const nameB = groups[b][0].person.name;
        return nameA.localeCompare(nameB);
      });

      sortedPersonIds.forEach(pId => {
        const personName = groups[pId][0].person.name;
        list.push({
          type: 'group-header',
          id: `header-person-${pId}`,
          title: personName,
          count: groups[pId].length,
          total: groups[pId].reduce((sum, po) => sum + po.totalCost, 0),
        });

        groups[pId].forEach(po => {
          list.push({
            type: 'order-card',
            id: `order-${po.order.id}`,
            po,
          });
        });
      });
    } else {
      sortedOrders.forEach(po => {
        list.push({
          type: 'order-card',
          id: `order-${po.order.id}`,
          po,
        });
      });
    }

    return list;
  }, [sortedOrders, groupBy, sortOrder]);

  // Order Handlers
  const handleMarkAllPaid = async (orderId: string, personId: string) => {
    try {
      await api.markOrderPaid(orderId, personId);
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), t('run.failedMarkPaid'));
    }
  };

  const handleMarkAllUnpaid = async (orderId: string, personId: string) => {
    try {
      await api.markOrderUnpaid(orderId, personId);
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), t('run.failedMarkUnpaid'));
    }
  };

  const handleCustomPayment = async (value: string, markAllPast: boolean = false) => {
    if (!payAmountOrder) return;
    const paidAmount = parseFloat(value);
    if (isNaN(paidAmount)) {
      Alert.alert(t('common.error'), t('common.invalidAmount'));
      return;
    }

    const { id: orderId, personId, total: orderTotal, date: orderDate } = payAmountOrder;
    setPayAmountOrder(null);

    try {
      if (markAllPast) {
        await api.markAllOrdersPaidSilently(personId);
      } else {
        await api.markOrderPaid(orderId, personId);
      }

      const diff = markAllPast ? paidAmount : paidAmount - orderTotal;
      if (Math.abs(diff) > 0.001 || (markAllPast && paidAmount !== 0)) {
        await api.changeBalance(personId, markAllPast ? paidAmount : diff, t('run.paymentAdjustment', { date: orderDate }));
      }
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), t('run.failedMarkPaid'));
    }
  };

  const handleDeleteOrder = (orderId: string, personName: string, isPaid: boolean) => {
    if (isPaid) {
      Alert.alert(
        t('run.deleteOrderTitle'),
        t('run.deletePaidOrderConfirm', { name: personName }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('run.deleteOrderCashReturned'),
            style: 'destructive',
            onPress: async () => {
              try {
                await api.deleteOrder(orderId, true);
              } catch (e) {
                console.error(e);
                Alert.alert(t('common.error'), t('run.failedDelete'));
              }
            },
          },
          {
            text: t('run.deleteOrderKeepCredit'),
            onPress: async () => {
              try {
                await api.deleteOrder(orderId, false);
              } catch (e) {
                console.error(e);
                Alert.alert(t('common.error'), t('run.failedDelete'));
              }
            },
          },
        ]
      );
    } else {
      Alert.alert(
        t('run.deleteOrderTitle'),
        t('run.deleteOrderConfirm', { name: personName }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              try {
                await api.deleteOrder(orderId);
              } catch (e) {
                console.error(e);
                Alert.alert(t('common.error'), t('run.failedDelete'));
              }
            },
          },
        ]
      );
    }
  };

  const handleEditOrder = (order: any, person: any) => {
    router.push({
      pathname: '/add-order',
      params: {
        personId: person.id,
        date: order.targetDate,
        edit: Date.now().toString()
      }
    });
  };

  const toggleSort = (type: typeof sortBy) => {
    if (sortBy === type) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(type);
      setSortOrder(type === 'date' ? 'desc' : 'asc');
    }
  };

  // Group Header Date Formatter
  const renderGroupHeader = (title: string, count: number, total: number) => {
    let displayTitle = title;
    if (groupBy === 'day') {
      try {
        const [year, month, day] = title.split('-').map(Number);
        const parsedDate = new Date(year, month - 1, day);
        displayTitle = formatDateLabel(parsedDate, t, t('modals.daysShort'));
      } catch (e) {
        displayTitle = title;
      }
    }

    return (
      <View style={[styles.groupHeader, settings.compactMode && styles.groupHeaderCompact]}>
        <Text style={[styles.groupTitle, settings.compactMode && styles.groupTitleCompact]}>
          {displayTitle}
        </Text>
        <View style={styles.groupMeta}>
          <Text style={[styles.groupMetaText, settings.compactMode && styles.textExtraSmall]}>
            {t('unsettled.unpaidOrdersCount', { count })}
          </Text>
          <Text style={[styles.groupTotalCost, settings.compactMode && styles.groupTitleCompact]}>
            ${total.toFixed(2)}
          </Text>
        </View>
      </View>
    );
  };

  // FlatList Render Item
  const renderFlatItem = React.useCallback(({ item }: { item: any }) => {
    if (item.type === 'group-header') {
      return renderGroupHeader(item.title, item.count, item.total);
    }

    if (item.type === 'order-card') {
      return (
        <UnsettledOrderCard
          po={item.po}
          compactMode={settings.compactMode}
          isRTL={isRTL}
          t={t}
          showDate={groupBy !== 'day'}
          onEdit={handleEditOrder}
          onDelete={handleDeleteOrder}
          onPayAmount={(payInfo) => setPayAmountOrder({ ...payInfo, date: item.po.order.targetDate })}
          onMarkPaid={handleMarkAllPaid}
          onMarkUnpaid={handleMarkAllUnpaid}
          onUnknownPrice={setUnknownPricePerson}
          onHistory={setLogPerson}
          onOrdersClick={setOrdersPerson}
        />
      );
    }

    return null;
  }, [groupBy, settings.compactMode, isRTL, t]);

  // Resolving Group By Label and value mapping
  const groupByValueLabel = useMemo(() => {
    if (groupBy === 'day') return t('unsettled.groupByDay');
    if (groupBy === 'person') return t('unsettled.groupByPerson');
    return t('unsettled.noGrouping');
  }, [groupBy, t]);

  // Resolving Sort By Label and value mapping
  const sortByValueLabel = useMemo(() => {
    if (sortBy === 'date') return t('unsettled.sortByDate');
    if (sortBy === 'amount') return t('unsettled.sortByAmount');
    return t('unsettled.sortByName');
  }, [sortBy, t]);

  const renderHeader = () => {
    return (
      <View>
        {isSearching && (
          <TouchableOpacity
            style={[styles.exitSearchBtn, settings.compactMode && styles.exitSearchBtnCompact]}
            onPress={() => {
              setIsSearching(false);
              setSearchQuery('');
              Keyboard.dismiss();
            }}
          >
            <FontAwesome name={I18nManager.isRTL ? "chevron-right" : "chevron-left"} size={settings.compactMode ? 12 : 14} color={ACCENT_GOLD} />
            <Text style={[styles.exitSearchText, settings.compactMode && styles.textSmall]}>{t('addOrder.exitSearch')}</Text>
          </TouchableOpacity>
        )}

        {!isSearching && (
          <View style={[styles.headerRow, settings.compactMode && styles.headerRowCompact]}>
            <Text style={[styles.title, settings.compactMode && styles.titleCompact]}>{t('unsettled.title')}</Text>
          </View>
        )}

        {/* Total Owed Banner */}
        <LinearGradient
          colors={METALLIC_BEVEL}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.stripOuter}
        >
          <LinearGradient
            colors={LIQUID_GOLD_STOPS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.stripInner}
          >
            <Text style={[styles.stripTitle, settings.compactMode && styles.stripTitleCompact]}>
              {t('unsettled.totalOwedLabel', { amount: totalOutstandingOwed.toFixed(2) })}
            </Text>
          </LinearGradient>
        </LinearGradient>

        <View style={[styles.searchContainer, settings.compactMode && styles.searchContainerCompact]}>
          <TextInput
            style={[styles.searchInput, settings.compactMode && styles.searchInputCompact]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('unsettled.searchPlaceholder')}
            placeholderTextColor="#888"
            onFocus={() => setIsSearching(true)}
            onBlur={() => { if (!searchQuery) setIsSearching(false); }}
          />
        </View>

        {!isSearching && (
          <View style={[
            styles.filterBarRow, 
            settings.compactMode && styles.filterBarRowCompact,
          ]}>
            <View style={styles.dropdownContainer}>
              <Text style={[
                styles.dropdownLabel, 
                { textAlign: isRTL ? 'right' : 'left' },
                settings.compactMode && styles.textExtraSmall
              ]}>
                {t('unsettled.groupBy')}
              </Text>
              <DropdownSelect
                compact={settings.compactMode}
                value={groupByValueLabel}
                options={[t('unsettled.groupByDay'), t('unsettled.groupByPerson'), t('unsettled.noGrouping')]}
                onSelect={(val) => {
                  if (val === t('unsettled.groupByDay')) setGroupBy('day');
                  else if (val === t('unsettled.groupByPerson')) setGroupBy('person');
                  else setGroupBy('none');
                }}
              />
            </View>

            <View style={styles.dropdownContainer}>
              <Text style={[
                styles.dropdownLabel, 
                { textAlign: isRTL ? 'right' : 'left' },
                settings.compactMode && styles.textExtraSmall
              ]}>
                {t('unsettled.sortBy')}
              </Text>
              <View style={[
                styles.sortTriggerRow,
              ]}>
                <View style={{ flex: 1 }}>
                  <DropdownSelect
                    compact={settings.compactMode}
                    value={sortByValueLabel}
                    options={[t('unsettled.sortByDate'), t('unsettled.sortByAmount'), t('unsettled.sortByName')]}
                    onSelect={(val) => {
                      if (val === t('unsettled.sortByDate')) setSortBy('date');
                      else if (val === t('unsettled.sortByAmount')) setSortBy('amount');
                      else setSortBy('name');
                    }}
                  />
                </View>
                <TouchableOpacity
                  style={[
                    styles.sortOrderToggleBtn,
                    settings.compactMode && { height: 36, width: 36, borderRadius: 6 }
                  ]}
                  onPress={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                >
                  <FontAwesome
                    name={sortOrder === 'asc' ? "sort-amount-asc" : "sort-amount-desc"}
                    size={settings.compactMode ? 12 : 16}
                    color={ACCENT_GOLD}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderEmpty = () => {
    if (unsettledOrdersList.length === 0) {
      return (
        <View style={styles.noResultsContainer}>
          <FontAwesome name="check-circle" size={48} color="#5c8a6a" style={{ marginBottom: 10 }} />
          <Text style={styles.noResultsText}>{t('unsettled.emptyList')}</Text>
        </View>
      );
    }

    if (filteredOrders.length === 0 && searchQuery.trim() !== '') {
      return (
        <View style={styles.noResultsContainer}>
          <FontAwesome name="search" size={48} color="#444" style={{ marginBottom: 10 }} />
          <Text style={styles.noResultsText}>{t('run.noOrdersFound', { query: searchQuery })}</Text>
        </View>
      );
    }

    return null;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <FlatList
        data={flatListData}
        renderItem={renderFlatItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader()}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[styles.content, settings.compactMode && styles.contentCompact, { paddingBottom: 120 }]}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        windowSize={5}
        removeClippedSubviews={true}
      />

      {/* Credit Log Modal */}
      {logPerson && (
        <CreditLogModal
          visible={!!logPerson}
          personId={logPerson.id}
          personName={logPerson.name}
          onClose={() => setLogPerson(null)}
        />
      )}

      {/* Unknown Price Items Modal */}
      {unknownPricePerson && (
        <UnknownPriceModal
          visible={!!unknownPricePerson}
          personId={unknownPricePerson.id}
          personName={unknownPricePerson.name}
          onClose={() => setUnknownPricePerson(null)}
        />
      )}

      {/* Custom Payment Prompt Modal */}
      {payAmountOrder && (
        <PromptModal
          visible={!!payAmountOrder}
          title={t('run.payAmountTitle')}
          message={t('run.payAmountMsg', { total: payAmountOrder.total.toFixed(2), name: payAmountOrder.personName })}
          defaultValue={payAmountOrder.total.toFixed(2)}
          keyboardType="numeric"
          showToggle={true}
          toggleLabel={t('run.markAllPastAsPaid')}
          onCancel={() => setPayAmountOrder(null)}
          onSubmit={handleCustomPayment}
        />
      )}

      {/* Historical Orders Modal */}
      {ordersPerson && (
        <PersonOrdersModal
          visible={!!ordersPerson}
          personId={ordersPerson.id}
          personName={ordersPerson.name}
          onClose={() => setOrdersPerson(null)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ==========================================
// MEMOIZED PERFORMANCE-OPTIMIZED CARD COMPONENTS
// ==========================================

interface OrderItemRowProps {
  item: any;
  compactMode: boolean;
  isRTL: boolean;
  t: (key: string, params?: any) => string;
}

const OrderItemRow = React.memo(function OrderItemRow({
  item,
  compactMode,
  isRTL,
  t,
}: OrderItemRowProps) {
  const itemCost = (item.unitPrice ?? 0) * item.quantity;
  return (
    <RNView style={[styles.itemRow2, compactMode && styles.itemRow2Compact]}>
      <RNView style={[styles.itemInfo, { alignItems: 'center', flexDirection: 'row', gap: 8, flexShrink: 1, overflow: 'hidden' }]}>
        <RNView style={[styles.quantityBadge, compactMode && styles.quantityBadgeCompact, item.isPaid && styles.quantityBadgeCrossed]}>
          <Text style={[styles.quantityText, compactMode && styles.quantityTextCompact, item.isPaid && styles.quantityTextCrossed]}>
            x{item.quantity}
          </Text>
        </RNView>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.itemText, { flexShrink: 1, marginStart: 0 }, compactMode && styles.textExtraSmall, item.isPaid && styles.personItemPaid]}>
          {isRTL ? '\u200F' : ''}{item.itemDef?.name}
        </Text>
      </RNView>
      <RNView style={styles.itemPriceContainer}>
        {item.unitPrice === null ? (
          <Text style={[styles.itemPrice, { color: '#ffeb3b', fontStyle: 'italic' }, compactMode && styles.textExtraSmall]}>{t('common.priceTBD')}</Text>
        ) : itemCost > 0 ? (
          <Text style={[styles.itemPrice, compactMode && styles.textExtraSmall, item.isPaid && styles.personItemPaid]}>${itemCost.toFixed(2)}</Text>
        ) : null}
      </RNView>
    </RNView>
  );
});

interface UnsettledOrderCardProps {
  po: any;
  compactMode: boolean;
  isRTL: boolean;
  t: (key: string, params?: any) => string;
  showDate: boolean;
  onEdit: (order: any, person: any) => void;
  onDelete: (orderId: string, personName: string, isPaid: boolean) => void;
  onPayAmount: (payInfo: { id: string; personId: string; total: number; personName: string }) => void;
  onMarkPaid: (orderId: string, personId: string) => void;
  onMarkUnpaid: (orderId: string, personId: string) => void;
  onUnknownPrice: (personInfo: { id: string; name: string }) => void;
  onHistory: (personInfo: { id: string; name: string }) => void;
  onOrdersClick: (personInfo: { id: string; name: string }) => void;
}

const UnsettledOrderCard = React.memo(function UnsettledOrderCard({
  po,
  compactMode,
  isRTL,
  t,
  showDate,
  onEdit,
  onDelete,
  onPayAmount,
  onMarkPaid,
  onMarkUnpaid,
  onUnknownPrice,
  onHistory,
  onOrdersClick,
}: UnsettledOrderCardProps) {
  // Format Date if shown on Card
  const formattedOrderDate = useMemo(() => {
    try {
      const [year, month, day] = po.order.targetDate.split('-').map(Number);
      const parsedDate = new Date(year, month - 1, day);
      return formatDateLabel(parsedDate, t, t('modals.daysShort'));
    } catch (e) {
      return po.order.targetDate;
    }
  }, [po.order.targetDate, t]);

  return (
    <RNView style={styles.cardShadow}>
      <RNView style={[styles.personCard, compactMode && styles.personCardCompact]}>
        <RNView style={[styles.personBody, compactMode && styles.personBodyCompact]}>
          <RNView style={[
            styles.personHeader, 
            compactMode && styles.personHeaderCompact,
          ]}>
            <RNView style={{ 
              flex: 1, 
              alignItems: 'flex-start', 
              overflow: 'hidden', 
              paddingEnd: 8,
              gap: 2 
            }}>
              <TouchableOpacity onPress={() => onOrdersClick({ id: po.person.id, name: po.person.name })}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[
                  styles.personName, 
                  compactMode && styles.personNameCompact, 
                  { color: LIGHT_GOLD, textDecorationLine: 'underline', textAlign: isRTL ? 'right' : 'left' }
                ]}>
                  {po.person.name}
                </Text>
              </TouchableOpacity>
              {po.deliveryPlace ? (
                <Text numberOfLines={1} ellipsizeMode="tail" style={[
                  styles.deliveryPlace, 
                  compactMode && styles.textExtraSmall,
                  { textAlign: isRTL ? 'right' : 'left' }
                ]}>
                  {po.deliveryPlace}
                </Text>
              ) : null}

              {/* Show date if not grouped by day */}
              {showDate ? (
                <RNView style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  marginTop: 2, 
                  gap: 4 
                }}>
                  <Text style={[styles.dateTypeLabel, compactMode && styles.textExtraSmall]}>
                    {t('unsettled.deliveryDate')}:
                  </Text>
                  <Text style={[styles.orderCreatedAt, compactMode && styles.orderCreatedAtCompact, { color: ACCENT_GOLD, fontWeight: 'bold' }]}>
                    {formattedOrderDate}
                  </Text>
                </RNView>
              ) : null}

              <RNView style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                marginTop: 2, 
                gap: 4 
              }}>
                <Text style={[styles.dateTypeLabel, compactMode && styles.textExtraSmall]}>
                  {t('unsettled.timeOfCreation')}:
                </Text>
                <Text style={[styles.orderCreatedAt, compactMode && styles.orderCreatedAtCompact]}>
                  {po.order.createdAt ? formatDateTime(po.order.createdAt, isRTL ? 'ar' : 'en') : t('modals.notAvailable')}
                </Text>
              </RNView>
            </RNView>

            <RNView style={[styles.costInfo, { alignItems: 'flex-end' }]}>
              <RNView style={[
                styles.orderActions,
              ]}>
                <RNView style={{ flexDirection: 'row', gap: 15 }}>
                  <TouchableOpacity onPress={() => onEdit(po.order, po.person)} style={styles.editOrderBtn}>
                    <FontAwesome name="edit" size={compactMode ? 14 : 16} color={ACCENT_GOLD} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onDelete(po.order.id, po.person.name, po.order.isPaid)} style={styles.deleteOrderBtn}>
                    <FontAwesome name="trash" size={compactMode ? 14 : 16} color="#ff4444" />
                  </TouchableOpacity>
                </RNView>
                <Text style={[
                  styles.personTotal, 
                  compactMode && styles.personTotalCompact,
                  { textAlign: isRTL ? 'left' : 'right' }
                ]}>
                  ${po.totalCost.toFixed(2)}{po.hasUnknownPriceItems ? ` + ${t('common.priceTBD')}` : ''}
                </Text>
              </RNView>
              <RNView style={[styles.statusContainer, compactMode && { height: 16 }]}>
                <Text style={[
                  styles.statusText, 
                  po.unpaidCost > 0 ? styles.statusUnpaid : styles.statusPaid, 
                  compactMode && styles.textExtraSmall
                ]}>
                  {po.hasUnknownPriceItems ? t('run.statusAwaitingPrices') : po.unpaidCost > 0 ? t('run.statusUnpaid') : t('run.statusPaid')}
                </Text>
              </RNView>
            </RNView>
          </RNView>

          <RNView style={styles.personItems}>
            {po.tasks && po.tasks.length > 0 && (
              <RNView style={{ marginBottom: po.items.length > 0 ? 10 : 0 }}>
                {po.tasks.map((task: any) => (
                  <TouchableOpacity
                    key={task.id}
                    style={[styles.personTaskRow, compactMode && styles.personTaskRowCompact]}
                    onPress={async () => {
                      try {
                        await api.completeTask(task.id, !task.isCompleted);
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                  >
                    <FontAwesome name={task.isCompleted ? "check-square-o" : "square-o"} size={compactMode ? 16 : 18} color={task.isCompleted ? "#4caf50" : "#888"} />
                    <Text style={[styles.personTaskText, task.isCompleted && styles.personTaskTextCompleted, compactMode && { fontSize: 14 }]}>
                      {task.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </RNView>
            )}
            {po.items.map((i: any) => (
              <OrderItemRow
                key={i.id}
                item={i}
                compactMode={compactMode}
                isRTL={isRTL}
                t={t}
              />
            ))}
          </RNView>
        </RNView>

        {/* Footer showing debt/credit and payment buttons */}
        <RNView style={[
          styles.personFooter,
          compactMode && styles.personFooterCompact,
          po.person.balance < 0 ? styles.footerDebt : po.person.balance > 0 ? styles.footerCredit : null
        ]}>
          <RNView>
            <RNView style={styles.balanceHeaderRow}>
              <Text style={[styles.balanceLabel, compactMode && styles.textExtraSmall, po.person.balance < 0 ? styles.debtLabel : po.person.balance > 0 ? styles.creditLabel : po.hasUnknownPriceItems ? styles.pendingLabel : styles.settledLabel]}>
                {po.person.balance < 0
                  ? t('run.debtLabel')
                  : po.person.balance > 0
                    ? t('run.creditLabel')
                    : po.hasUnknownPriceItems
                      ? t('run.pendingLabel')
                      : t('run.settledLabel')}
              </Text>
              {po.hasUnknownPriceItems && (
                <TouchableOpacity
                  onPress={() => onUnknownPrice({ id: po.person.id, name: po.person.name })}
                  style={[styles.notesBtn, compactMode && styles.paddingSmall]}>
                  <FontAwesome name="exclamation-circle" size={compactMode ? 14 : 18} color="#ff9800" />
                </TouchableOpacity>
              )}
            </RNView>
            <RNView style={styles.balanceValueRow}>
              <Text style={[po.person.balance < 0 ? styles.debt : po.person.balance > 0 ? styles.credit : po.hasUnknownPriceItems ? styles.pending : styles.settled, compactMode && styles.personTotalCompact]}>
                ${Math.abs(po.person.balance).toFixed(2)}
              </Text>
              <TouchableOpacity
                onPress={() => onHistory({ id: po.person.id, name: po.person.name })}
                style={[styles.historyBtn, compactMode && styles.paddingSmall]}
              >
                <FontAwesome name="history" size={compactMode ? 14 : 16} color={ACCENT_GOLD} />
              </TouchableOpacity>
            </RNView>
          </RNView>

          <RNView style={styles.buttonGroup}>
            {po.hasUnpaidItems ? (
              <RNView style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => onPayAmount({ id: po.order.id, personId: po.person.id, total: po.totalCost, personName: po.person.name })}>
                  <RNView style={styles.paymentShadow}>
                    <LinearGradient
                      colors={METALLIC_BEVEL}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={[styles.paymentBtnOuter, compactMode && { borderRadius: 5 }]}
                    >
                      <LinearGradient
                        colors={LIQUID_GOLD_STOPS}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.paymentBtnInner, compactMode && styles.compactBtn]}
                      >
                        <Text style={[styles.markAllPaidText, compactMode && styles.textExtraSmall]}>{t('run.payAmountTitle')}</Text>
                      </LinearGradient>
                    </LinearGradient>
                  </RNView>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => onMarkPaid(po.order.id, po.person.id)}>
                  <RNView style={styles.paymentShadow}>
                    <LinearGradient
                      colors={METALLIC_BEVEL}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={[styles.paymentBtnOuter, compactMode && { borderRadius: 5 }]}
                    >
                      <LinearGradient
                        colors={LIQUID_GOLD_STOPS}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.paymentBtnInner, compactMode && styles.compactBtn]}
                      >
                        <Text style={[styles.markAllPaidText, compactMode && styles.textExtraSmall]}>{t('run.markPaid')}</Text>
                      </LinearGradient>
                    </LinearGradient>
                  </RNView>
                </TouchableOpacity>
              </RNView>
            ) : (
              <TouchableOpacity
                style={[styles.markAllUnpaidBtn, compactMode && styles.compactBtn]}
                onPress={() => onMarkUnpaid(po.order.id, po.person.id)}>
                <Text style={[styles.markAllUnpaidText, compactMode && styles.textExtraSmall]}>{t('run.revertLastPayment')}</Text>
              </TouchableOpacity>
            )}
          </RNView>
        </RNView>
      </RNView>
    </RNView>
  );
});

// ==========================================
// PREMIUM METALLIC & GLASSMORPHIC STYLES
// ==========================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  content: { padding: 15 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', letterSpacing: 1.2 },
  
  // Outstanding outstanding balance banner
  stripOuter: {
    marginBottom: 15,
    borderRadius: 12,
    padding: 1.5,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  stripInner: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 11,
    width: '100%',
  },
  stripTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
  },
  stripTitleCompact: {
    fontSize: 15,
  },

  searchContainer: {
    marginBottom: 15,
  },
  searchInput: {
    backgroundColor: '#333',
    color: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    fontSize: 16,
    width: '100%',
  },
  searchInputCompact: {
    paddingVertical: 8,
    fontSize: 14,
  },
  personTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  personTaskRowCompact: {
    paddingVertical: 4,
  },
  personTaskText: {
    color: '#fff',
    fontSize: 15,
  },
  personTaskTextCompleted: {
    color: '#888',
    textDecorationLine: 'line-through',
  },
  searchContainerCompact: {
    marginBottom: 8,
  },

  exitSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 15,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  exitSearchBtnCompact: {
    padding: 8,
  },
  exitSearchText: {
    color: ACCENT_GOLD,
    fontWeight: 'bold',
  },

  // Group Header Styling
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 6,
    marginStart: 4,
  },
  groupHeaderCompact: {
    marginTop: 10,
    marginBottom: 8,
    paddingBottom: 4,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: LIGHT_GOLD,
  },
  groupTitleCompact: {
    fontSize: 14,
  },
  groupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupMetaText: {
    color: '#888',
    fontSize: 12,
  },
  groupTotalCost: {
    fontSize: 16,
    fontWeight: 'bold',
    color: ACCENT_GOLD,
  },

  // Dropdown Filter Row
  filterBarRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 15,
  },
  filterBarRowCompact: {
    marginBottom: 10,
    gap: 8,
  },
  dropdownContainer: {
    flex: 1,
    gap: 4,
  },
  dropdownLabel: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
  },
  sortTriggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sortOrderToggleBtn: {
    backgroundColor: '#333',
    height: 48,
    width: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Card Styling
  cardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  personCard: { backgroundColor: '#222', borderRadius: 10, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#333' },
  personBody: { padding: 15 },
  personHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  personName: { fontSize: 18, fontWeight: 'bold', color: '#fff', textAlign: 'left' },
  personTotal: { fontSize: 18, fontWeight: 'bold', color: ACCENT_GOLD, textAlign: 'right' },
  deliveryPlace: { fontSize: 12, color: LIGHT_GOLD, marginTop: 2, textAlign: 'left' },
  costInfo: { alignItems: 'flex-end', flex: 1 },
  orderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editOrderBtn: { padding: 4 },
  deleteOrderBtn: { padding: 4 },
  statusContainer: { height: 20, justifyContent: 'center' },
  statusText: { fontSize: 12, fontWeight: 'bold' },
  statusUnpaid: { color: '#ffa726' },
  statusPaid: { color: '#5c8a6a' },
  personItems: { marginBottom: 5, marginTop: 5 },
  itemRow2: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  itemInfo: { flex: 1 },
  itemText: { fontSize: 15, color: '#fff' },
  personItemText: { color: '#ccc', fontSize: 14 },
  personItemPaid: { textDecorationLine: 'line-through', color: '#666' },
  
  // Footer
  personFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 12,
    paddingBottom: 15,
    paddingHorizontal: 15,
  },
  footerDebt: { backgroundColor: '#352828', borderTopColor: '#4a3535' },
  footerCredit: { backgroundColor: '#2a312c', borderTopColor: '#354a3d' },
  balanceHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  balanceValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  historyBtn: { padding: 4 },
  balanceLabel: { fontSize: 12, fontWeight: '600', marginBottom: 3 },
  notesBtn: { padding: 4 },
  debtLabel: { color: '#a24949' },
  creditLabel: { color: '#5c8a6a' },
  pendingLabel: { color: '#ffa726' },
  settledLabel: { color: '#8c8c8c' },
  debt: { color: '#a24949', fontWeight: 'bold', fontSize: 16 },
  credit: { color: '#5c8a6a', fontWeight: 'bold', fontSize: 16 },
  pending: { color: '#ffa726', fontWeight: 'bold', fontSize: 16 },
  settled: { color: '#8c8c8c', fontWeight: 'bold', fontSize: 16 },
  buttonGroup: { alignItems: 'flex-end', flex: 1 },
  paymentShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
    borderRadius: 5,
  },
  paymentBtnOuter: {
    borderRadius: 5,
    padding: 1.5,
  },
  paymentBtnInner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  markAllPaidText: { color: '#1a1a1a', fontWeight: 'bold', fontSize: 13 },
  markAllUnpaidBtn: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#444',
  },
  markAllUnpaidText: { color: ACCENT_GOLD, fontWeight: 'bold', fontSize: 13 },
  quantityBadge: { backgroundColor: '#3d3522', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  quantityText: { color: '#eee', fontWeight: 'bold', fontSize: 12 },
  quantityBadgeCompact: { backgroundColor: '#3d3522', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  quantityTextCompact: { fontSize: 12 },
  quantityBadgeCrossed: { opacity: 0.7 },
  quantityTextCrossed: { color: '#666', textDecorationLine: 'line-through' },
  itemPriceContainer: { width: 60, alignItems: 'flex-end' },
  itemPrice: { fontSize: 14, color: '#aaa', fontWeight: '500' },
  orderCreatedAt: { color: '#888', fontSize: 12 },
  orderCreatedAtCompact: { fontSize: 10 },
  dateTypeLabel: { color: '#666', fontSize: 12, fontWeight: '500' },

  // Compact Modifiers
  contentCompact: { padding: 8 },
  headerRowCompact: { marginBottom: 12 },
  titleCompact: { fontSize: 20 },
  personCardCompact: { marginBottom: 10 },
  personBodyCompact: { padding: 10 },
  personHeaderCompact: { marginBottom: 5 },
  personNameCompact: { fontSize: 15 },
  personTotalCompact: { fontSize: 15 },
  itemRow2Compact: { marginBottom: 2 },
  personFooterCompact: { paddingTop: 8, paddingBottom: 10, paddingHorizontal: 10 },
  compactBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  textSmall: { fontSize: 13 },
  textExtraSmall: { fontSize: 11 },
  paddingSmall: { padding: 4 },
  noResultsContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222',
    borderRadius: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#444',
    borderStyle: 'dashed',
  },
  noResultsText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
  },
});
