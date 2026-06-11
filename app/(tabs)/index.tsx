import CreditLogModal from '@/components/CreditLogModal';
import PromptModal from '@/components/PromptModal';
import { Text, View, TextInput } from '@/components/Themed';
import UnknownPriceModal from '@/components/UnknownPriceModal';
import { db } from '@/db';
import { api } from '@/db/api';
import { items, orderItems, orders, persons, tasks } from '@/db/schema';
import { formatDateLabel, formatDateTime, generateDateOptions, getDefaultDate, getLocalDateString } from '@/utils/dates';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from '@/utils/i18n';
import { useSettings } from '@/utils/settings';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import { eq } from 'drizzle-orm';

import { ACCENT_GOLD, GOLD, LIGHT_GOLD, LIQUID_GOLD_STOPS, METALLIC_BEVEL } from '@/constants/Colors';
// -----------------------
import { useFocusEffect } from 'expo-router';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Alert, AppState, I18nManager, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, FlatList } from 'react-native';

const getHardwareInfo = () => {
  return {
    os: Platform.OS,
    osVersion: Platform.Version,
    deviceName: Constants.deviceName || 'Unknown Device',
    isDevice: Constants.isDevice,
    jsEngine: (global as any).HermesInternal ? 'Hermes' : 'JSC',
  };
};

const ENABLE_PERF_LOGGING = true; // Set to false to completely disable performance tracing logs

const perfLog = (message: string) => {
  if (__DEV__ && ENABLE_PERF_LOGGING) {
    console.log(message);
  }
};

export default function TheRunScreen() {
  const [targetDate, setTargetDate] = useState(getDefaultDate());
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [paidItems, setPaidItems] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Unknown price notes modal
  const [unknownPricePerson, setUnknownPricePerson] = useState<{ id: string; name: string } | null>(null);

  // Credit log modal
  const [logPerson, setLogPerson] = useState<{ id: string; name: string } | null>(null);

  // Collapsible states
  const [collapsedSources, setCollapsedSources] = useState<Record<string, boolean>>({});
  const [collapsedLocations, setCollapsedLocations] = useState<Record<string, boolean>>({});

  const router = useRouter();

  // Multi-select mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [showMoveDatePicker, setShowMoveDatePicker] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [payAmountOrder, setPayAmountOrder] = useState<{ id: string; personId: string; total: number; personName: string } | null>(null);

  // Performance tracking refs
  const dateChangePerfRef = useRef<{
    date: string;
    startTime: number;
    prevDate: string;
  } | null>(null);
  const renderCountRef = useRef(0);
  renderCountRef.current++;

  const currentRender = renderCountRef.current;
  const renderStartTime = performance.now();
  perfLog(`[PERF] [Render Start] Render #${currentRender} started. Target date state: ${getLocalDateString(targetDate)}`);

  const { settings } = useSettings();
  const { t, isRTL } = useTranslation();

  const dateOptions = useMemo(() => generateDateOptions(t, t('modals.daysShort')), [t]);

  // Force re-render when screen is focused to refresh "Today" labels
  useFocusEffect(
    React.useCallback(() => {
      setRefreshKey(prev => prev + 1);
    }, [])
  );

  // Refresh when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        setRefreshKey(prev => prev + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  // Profile rendering overhead and transition transaction duration
  useEffect(() => {
    const renderEndTime = performance.now();
    const renderDuration = renderEndTime - renderStartTime;
    perfLog(`[PERF] [Render End] Render #${currentRender} commit/layout finished in ${renderDuration.toFixed(2)}ms.`);

    const targetDateStr = getLocalDateString(targetDate);
    if (dateChangePerfRef.current && dateChangePerfRef.current.date === targetDateStr) {
      const totalTime = renderEndTime - dateChangePerfRef.current.startTime;
      const hw = getHardwareInfo();
      perfLog(`[PERF] [Complete Transition] Date change completed!
        - Transition: ${dateChangePerfRef.current.prevDate} -> ${dateChangePerfRef.current.date}
        - Total duration: ${totalTime.toFixed(2)}ms
        - System Hardware: OS=${hw.os} (v${hw.osVersion}), Device Model=${hw.deviceName}, JS Engine=${hw.jsEngine}`);
      dateChangePerfRef.current = null;
      setIsTransitioning(false);
    }
  });

  const targetDateDb = getLocalDateString(targetDate);

  const { data: allOrders } = useLiveQuery(
    db.select().from(orders).where(eq(orders.targetDate, targetDateDb)),
    [targetDateDb]
  );
  const { data: allOrderItems } = useLiveQuery(
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
    .where(eq(orders.targetDate, targetDateDb)),
    [targetDateDb]
  );
  const { data: catalog } = useLiveQuery(db.select().from(items));
  const { data: people } = useLiveQuery(db.select().from(persons));
  const { data: allTasks } = useLiveQuery(db.select().from(tasks));

  const { aggregatedItems, peopleOrders, listTotal, generalTasks, physicalChecklist } = useMemo(() => {
    const memoStart = performance.now();
    const agg: Record<string, { item: any; totalQuantity: number; totalCost: number }> = {};
    const pOrders: Record<string, { person: any; order: any; items: any[]; tasks: any[]; totalCost: number; unpaidCost: number; hasUnpaidItems: boolean; hasUnknownPriceItems: boolean; deliveryPlace: string | null }> = {};

    if (!allOrders || !allOrderItems || !catalog || !people || !allTasks) {
      perfLog(`[PERF] [useMemo] DB tables not fully loaded yet inside Render #${renderCountRef.current}`);
      return { aggregatedItems: {}, peopleOrders: [], listTotal: 0, generalTasks: [], physicalChecklist: [] };
    }

    const targetDateDb = getLocalDateString(targetDate);
    const filteredOrders = allOrders.filter(o => o.targetDate === targetDateDb);
    const filteredTasks = allTasks.filter(t => !t.targetDate || t.targetDate === targetDateDb);

    const generalTasks = filteredTasks.filter(t => !t.personId && (t.type === 'general_task' || t.type === 'meetup_task') && (!t.isCompleted || t.targetDate === targetDateDb));
    const physicalChecklist = filteredTasks.filter(t => !t.personId && (t.type === 'physical_give' || t.type === 'physical_take') && (!t.isCompleted || t.targetDate === targetDateDb));
    const personTasks = filteredTasks.filter(t => !!t.personId && (!t.isCompleted || t.targetDate === targetDateDb));

    // Count stats for profiling
    let totalItemsQuantity = 0;
    let totalOrderItemsCount = 0;
    filteredOrders.forEach((order) => {
      const itemsForOrder = allOrderItems.filter((oi) => oi.orderId === order.id);
      totalOrderItemsCount += itemsForOrder.length;
      totalItemsQuantity += itemsForOrder.reduce((sum, item) => sum + item.quantity, 0);
    });
    const avgItemsPerOrder = filteredOrders.length > 0 ? (totalItemsQuantity / filteredOrders.length) : 0;
    const avgOrderItemsPerOrder = filteredOrders.length > 0 ? (totalOrderItemsCount / filteredOrders.length) : 0;

    perfLog(`[PERF] [useMemo Start] Processing data for date: ${targetDateDb} (Render #${renderCountRef.current}).
      - Total DB sizes: orders=${allOrders.length}, orderItems=${allOrderItems.length}, catalog=${catalog.length}, people=${people.length}
      - Selected day stats: orders=${filteredOrders.length}, orderItemsRows=${totalOrderItemsCount} (avg=${avgOrderItemsPerOrder.toFixed(1)}/order), itemsSum=${totalItemsQuantity} (avg=${avgItemsPerOrder.toFixed(1)}/order)`);

    filteredOrders.forEach((order) => {
      const person = people.find((p) => p.id === order.personId);
      const itemsForOrder = allOrderItems.filter((oi) => oi.orderId === order.id);

      let totalCost = 0;
      let unpaidCost = 0;
      let hasUnpaidItems = false;
      let hasUnknownPriceItems = false;

      const orderDetails = itemsForOrder.map((oi) => {
        const itemDef = catalog.find((c) => c.id === oi.itemId);
        const cost = (oi.unitPrice ?? 0) * oi.quantity;
        totalCost += cost;

        if (!oi.isPaid) {
          unpaidCost += cost;
          hasUnpaidItems = true;
          if (oi.unitPrice === null) hasUnknownPriceItems = true;
        }

        if (itemDef) {
          if (!agg[itemDef.id]) {
            agg[itemDef.id] = { item: itemDef, totalQuantity: 0, totalCost: 0 };
          }
          agg[itemDef.id].totalQuantity += oi.quantity;
          agg[itemDef.id].totalCost += cost;
        }

        return { ...oi, itemDef };
      });

      if (person) {
        pOrders[person.id] = {
          person,
          order,
          items: orderDetails,
          tasks: [],
          totalCost,
          unpaidCost,
          hasUnpaidItems,
          hasUnknownPriceItems,
          deliveryPlace: order.deliveryPlace || person.typicalPlace
        };
      }
    });

    personTasks.forEach(t => {
      const person = people.find(p => p.id === t.personId);
      if (person) {
        if (!pOrders[person.id]) {
          pOrders[person.id] = {
            person,
            order: { id: `task-only-${person.id}`, targetDate: targetDateDb, deliveryPlace: t.locationPlace || person.typicalPlace },
            items: [],
            tasks: [],
            totalCost: 0,
            unpaidCost: 0,
            hasUnpaidItems: false,
            hasUnknownPriceItems: false,
            deliveryPlace: t.locationPlace || person.typicalPlace
          };
        }
        pOrders[person.id].tasks.push(t);
      }
    });

    type AggItem = typeof agg[string];
    let groupedList: Record<string, Record<string, AggItem[]>>;

    function sortSources(srcs: string[]) {
      return srcs.sort((a, b) => {
        const idxA = settings.sourceOrder.indexOf(a);
        const idxB = settings.sourceOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });
    }

    if (settings.groupByFreshness) {
      const rawGrouped: Record<string, Record<string, AggItem[]>> = {};
      Object.values(agg).forEach(curr => {
        const timing = curr.item.timing || 'Anytime';
        const source = curr.item.source || 'Unknown';
        if (!rawGrouped[timing]) rawGrouped[timing] = {};
        if (!rawGrouped[timing][source]) rawGrouped[timing][source] = [];
        rawGrouped[timing][source].push(curr);
      });

      const sortedGrouped: Record<string, Record<string, AggItem[]>> = {};
      ['Fresh', 'Anytime'].forEach(timing => {
        if (rawGrouped[timing]) {
          sortedGrouped[timing] = {};
          const sources = sortSources(Object.keys(rawGrouped[timing]));
          sources.forEach(src => {
            sortedGrouped[timing][src] = rawGrouped[timing][src];
          });
        }
      });
      groupedList = sortedGrouped;
    } else {
      const rawBySource = Object.values(agg).reduce((acc, curr) => {
        const source = curr.item.source || 'Unknown';
        if (!acc[source]) acc[source] = [];
        acc[source].push(curr);
        return acc;
      }, {} as Record<string, AggItem[]>);

      const sortedBySource: Record<string, AggItem[]> = {};
      const sources = sortSources(Object.keys(rawBySource));
      sources.forEach(src => {
        sortedBySource[src] = rawBySource[src];
      });
      groupedList = { _all: sortedBySource };
    }

    const groupedDeliveries: Record<string, typeof pOrders[string][]> = {};
    Object.values(pOrders).forEach((po) => {
      const loc = po.deliveryPlace || 'No Location';
      if (!groupedDeliveries[loc]) groupedDeliveries[loc] = [];
      groupedDeliveries[loc].push(po);
    });

    const sortedLocations = Object.keys(groupedDeliveries).sort((a, b) => {
      const idxA = settings.locationOrder.indexOf(a);
      const idxB = settings.locationOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    const listTotal = Object.values(agg).reduce((sum, item) => sum + item.totalCost, 0);

    const memoEnd = performance.now();
    const memoDuration = memoEnd - memoStart;
    perfLog(`[PERF] [useMemo End] Processing completed in ${memoDuration.toFixed(2)}ms (Render #${renderCountRef.current}).`);

    return {
      aggregatedItems: groupedList,
      peopleOrders: sortedLocations.map(loc => ({
        location: loc,
        orders: groupedDeliveries[loc] || []
      })),
      listTotal,
      generalTasks,
      physicalChecklist,
    };
  }, [allOrders, allOrderItems, catalog, people, allTasks, targetDate, settings.groupByFreshness, settings.locationOrder, settings.sourceOrder, targetDate, refreshKey]);

  const flatListData = useMemo(() => {
    const list: any[] = [];

    if (isSearching) {
      list.push({ type: 'exit-search', id: 'exit-search' });
    }

    if (!isSearching) {
      if (generalTasks.length > 0) {
        list.push({ type: 'general-tasks', id: 'general-tasks', tasks: generalTasks });
      }

      if (physicalChecklist.length > 0) {
        list.push({ type: 'physical-checklist', id: 'physical-checklist', tasks: physicalChecklist });
        list.push({ type: 'separator', id: 'shopping-separator-checklist' });
      }

      list.push({ type: 'shopping-header', id: 'shopping-header', listTotal });

      Object.entries(aggregatedItems).forEach(([timingKey, sources]) => {
        if (settings.groupByFreshness && timingKey !== '_all') {
          list.push({ type: 'shopping-timing', id: `timing-${timingKey}`, timingKey });
        }
        Object.entries(sources).forEach(([source, itemsList]) => {
          const sourceKey = `${timingKey}-${source}`;
          list.push({
            type: 'shopping-source',
            id: `source-${sourceKey}`,
            source,
            itemsList,
            sourceKey,
          });
        });
      });

      list.push({ type: 'separator', id: 'shopping-separator' });
    }

    list.push({ type: 'deliveries-header', id: 'deliveries-header' });

    let totalFoundOrders = 0;
    peopleOrders.forEach((group) => {
      const q = searchQuery.toLowerCase().trim();
      const filteredOrders = !q ? group.orders : group.orders.filter(po => {
        const itemNames = po.items.map(i => i.itemDef?.name || '').join(' ');
        const searchString = [
          po.person.name,
          po.deliveryPlace,
          itemNames,
          po.totalCost.toFixed(2)
        ].join(' ').toLowerCase();
        return searchString.includes(q);
      });

      if (filteredOrders.length > 0) {
        list.push({
          type: 'location-header',
          id: `location-${group.location}`,
          location: group.location,
        });

        const isCollapsed = collapsedLocations[group.location];
        if (!isCollapsed) {
          filteredOrders.forEach((po, index) => {
            totalFoundOrders++;
            
            // 1. Person Header
            list.push({
              type: 'person-header',
              id: `person-header-${po.person.id}-${po.order.id}`,
              person: po.person,
              deliveryPlace: po.deliveryPlace
            });
            
            const hasTasks = po.tasks && po.tasks.length > 0;
            const hasOrder = po.items && po.items.length > 0;
            
            // 2. Order Card
            if (hasOrder) {
              list.push({
                type: 'order-card',
                id: `order-card-${po.order.id}`,
                po,
                isLastInThread: !hasTasks
              });
            }

            // 3. Task Card
            if (hasTasks) {
              list.push({
                type: 'task-card',
                id: `task-card-${po.person.id}-${po.order.id}`,
                po,
                isLastInThread: !hasOrder
              });
            }
          });
        }
      }
    });

    if (peopleOrders.length === 0 && !isSearching) {
      list.push({ type: 'empty-deliveries', id: 'empty-deliveries' });
    }

    const q = searchQuery.toLowerCase().trim();
    if (q && totalFoundOrders === 0) {
      list.push({ type: 'no-results', id: 'no-results' });
    }

    return list;
  }, [
    isSearching,
    listTotal,
    aggregatedItems,
    settings.groupByFreshness,
    peopleOrders,
    searchQuery,
    collapsedLocations,
    collapsedSources,
    selectedOrders,
    selectionMode,
    checkedItems,
    generalTasks,
    physicalChecklist,
  ]);

  const toggleTaskStatus = async (taskId: string, currentStatus: boolean, taskTargetDate?: string | null) => {
    try {
      const updates: any = { isCompleted: !currentStatus };
      if (!currentStatus && !taskTargetDate) {
        updates.targetDate = getLocalDateString(targetDate);
      }
      await api.updateTask(taskId, updates);
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), 'Failed to toggle task status');
    }
  };

  const handleEditTask = (task: any) => {
    router.push({ pathname: '/add-order', params: { editTaskId: task.id } });
  };

  const handleDeleteTask = (taskId: string, title: string) => {
    Alert.alert(
      t('tasks.deleteTitle') || 'Delete Task',
      t('tasks.deleteConfirm', { title }) || `Are you sure you want to delete "${title}"?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete') || 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteTask(taskId);
            } catch (e) {
              console.error(e);
              Alert.alert(t('common.error'), t('tasks.failedDelete') || 'Failed to delete task');
            }
          },
        },
      ]
    );
  };

  const handleTaskLongPress = (task: any) => {
    Alert.alert(
      t('tasks.actionTitle') || 'Task Actions',
      t('tasks.actionMsg', { title: task.title }) || `What do you want to do with "${task.title}"?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.edit') || 'Edit',
          onPress: () => handleEditTask(task),
        },
        {
          text: t('common.delete') || 'Delete',
          style: 'destructive',
          onPress: () => handleDeleteTask(task.id, task.title),
        },
      ]
    );
  };

  const renderFlatItem = React.useCallback(({ item }: { item: any }) => {
    switch (item.type) {
      case 'exit-search':
        return (
          <TouchableOpacity
            style={[styles.exitSearchBtn, settings.compactMode && styles.exitSearchBtnCompact]}
            onPress={() => {
              setIsSearching(false);
              setSearchQuery('');
              Keyboard.dismiss();
            }}
          >
            <FontAwesome name={I18nManager.isRTL ? "chevron-right" : "chevron-left"} size={settings.compactMode ? 12 : 14} color={ACCENT_GOLD} />
            <Text style={[styles.exitSearchText, settings.compactMode && styles.textSmall]}>{t('run.exitSearch')}</Text>
          </TouchableOpacity>
        );
      case 'general-tasks':
        return (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.generalTasksRow} contentContainerStyle={{ gap: 10 }}>
            {item.tasks.map((task: any) => (
              <TouchableOpacity
                key={task.id}
                style={[styles.taskPill, task.isCompleted && styles.taskPillCompleted, settings.compactMode && styles.taskPillCompact]}
                onPress={() => toggleTaskStatus(task.id, task.isCompleted, task.targetDate)}
                onLongPress={() => handleTaskLongPress(task)}
              >
                <FontAwesome name={task.isCompleted ? "check-circle" : "circle-thin"} size={settings.compactMode ? 14 : 16} color={task.isCompleted ? ACCENT_GOLD : "#ccc"} />
                <Text style={[styles.taskPillText, task.isCompleted && styles.taskPillTextCompleted, settings.compactMode && styles.textExtraSmall]}>{task.title}</Text>
                {task.targetTime && <Text style={[styles.taskPillTime, settings.compactMode && styles.textExtraSmall]}>{task.targetTime}</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
        );
      case 'physical-checklist':
        return (
          <View style={styles.physicalChecklistContainer}>
            <Text style={[styles.physicalChecklistTitle, settings.compactMode && styles.textSmall]}>{t('tasks.physicalChecklist') || 'Physical Tasks Checklist'}</Text>
            {item.tasks.map((task: any) => (
              <TouchableOpacity
                key={task.id}
                style={[styles.checklistRow, settings.compactMode && styles.checklistRowCompact]}
                onPress={() => toggleTaskStatus(task.id, task.isCompleted, task.targetDate)}
                onLongPress={() => handleTaskLongPress(task)}
              >
                <FontAwesome name={task.isCompleted ? "check-square-o" : "square-o"} size={settings.compactMode ? 18 : 22} color={task.isCompleted ? ACCENT_GOLD : ACCENT_GOLD} />
                <Text style={[styles.checklistText, task.isCompleted && styles.checklistTextCompleted, settings.compactMode && styles.textSmall]}>
                  {task.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        );
      case 'shopping-header':
        return (
          <LinearGradient
            colors={METALLIC_BEVEL}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.shoppingListStripOuter}
          >
            <LinearGradient
              colors={LIQUID_GOLD_STOPS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.shoppingListStripInner}
            >
              <Text style={[styles.shoppingListTitle, settings.compactMode && styles.sectionTitleCompact, { marginBottom: 0 }]}>{t('run.shoppingList')}</Text>
              {item.listTotal > 0 && (
                <Text style={[styles.shoppingListTotal, settings.compactMode && styles.sectionTitleCompact, { marginBottom: 0 }]}>${item.listTotal.toFixed(2)}</Text>
              )}
            </LinearGradient>
          </LinearGradient>
        );
      case 'shopping-timing':
        return (
          <Text style={[styles.timingTitle, settings.compactMode && styles.timingTitleCompact]}>{item.timingKey}</Text>
        );
      case 'shopping-source': {
        const sourceTotal = getSourceTotal(item.itemsList);
        const isCollapsed = collapsedSources[item.sourceKey];
        return (
          <SourceGroupCard
            source={item.source}
            itemsList={item.itemsList}
            sourceTotal={sourceTotal}
            isCollapsed={isCollapsed}
            checkedItems={checkedItems}
            compactMode={settings.compactMode}
            isRTL={isRTL}
            onToggleCollapse={() => toggleSourceCollapse(item.sourceKey)}
            onToggleCheck={toggleCheck}
          />
        );
      }
      case 'separator':
        return <View style={styles.separator} />;
      case 'deliveries-header':
        return (
          <View style={[styles.deliveriesHeader, settings.compactMode && styles.deliveriesHeaderCompact]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <FontAwesome name="truck" size={settings.compactMode ? 18 : 22} color={ACCENT_GOLD} />
              <Text style={[styles.sectionTitle, settings.compactMode && styles.sectionTitleCompact, { marginBottom: 0 }]}>{t('run.deliveries')}</Text>
            </View>
            <TextInput
              style={[styles.searchInput, settings.compactMode && styles.searchInputCompact]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setIsSearching(true)}
              onBlur={() => { if (!searchQuery) setIsSearching(false); }}
              placeholder={t('run.searchPerson')}
              placeholderTextColor="#888"
            />
          </View>
        );
      case 'location-header': {
        const isCollapsed = collapsedLocations[item.location];
        return (
          <TouchableOpacity
            style={[styles.locationHeaderRow, settings.compactMode && styles.locationHeaderRowCompact]}
            onPress={() => toggleLocationCollapse(item.location)}
            activeOpacity={0.7}>
            <FontAwesome
              name={isCollapsed ? 'caret-right' : 'caret-down'}
              size={settings.compactMode ? 16 : 20}
              color={LIGHT_GOLD}
              style={{ width: 24, textAlign: 'center' }}
            />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.deliveryLocationTitle, settings.compactMode && styles.deliveryLocationTitleCompact, { flex: 1 }]}>
              📍 {item.location}
            </Text>
          </TouchableOpacity>
        );
      }
      case 'person-header': {
        return (
          <View style={[styles.personHeaderRow, settings.compactMode && styles.personHeaderRowCompact]}>
            <FontAwesome name="user" size={settings.compactMode ? 14 : 16} color={ACCENT_GOLD} style={{ width: 24, textAlign: 'center' }} />
            <Text style={[styles.personHeaderText, settings.compactMode && styles.personHeaderTextCompact]}>
              {item.person.name}
            </Text>
          </View>
        );
      }
      case 'task-card': {
        const po = item.po;
        const threadLineStyle: any = {
          position: 'absolute',
          top: 0,
          bottom: item.isLastInThread ? '50%' : 0,
          width: 2,
          backgroundColor: '#333',
          ...(isRTL ? { right: 11 } : { left: 11 })
        };
        const contentPadding = isRTL 
          ? { paddingRight: settings.compactMode ? 28 : 32, marginRight: 0 }
          : { paddingLeft: settings.compactMode ? 28 : 32, marginLeft: 0 };

        return (
          <View style={[{ position: 'relative' }, contentPadding, { marginBottom: settings.compactMode ? 8 : 12 }]}>
            <View style={threadLineStyle} />
            <View style={[styles.taskCardContainer, settings.compactMode && styles.taskCardContainerCompact]}>
              <View style={styles.taskCardHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <FontAwesome name="list-ul" size={14} color={ACCENT_GOLD} style={{ marginEnd: 6 }} />
                  <Text style={styles.taskCardTitle}>{t('tasks.otherMeetupTasks') || 'Meetup Tasks'}</Text>
                </View>
              </View>
              <View style={styles.personTasksContainer}>
                {po.tasks.map((task: any) => (
                  <View key={task.id} style={[styles.personTaskRow, settings.compactMode && styles.personTaskRowCompact]}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}
                      onPress={() => toggleTaskStatus(task.id, task.isCompleted, task.targetDate)}
                      onLongPress={() => handleTaskLongPress(task)}
                    >
                      <FontAwesome name={task.isCompleted ? "check-square-o" : "square-o"} size={settings.compactMode ? 16 : 18} color={task.isCompleted ? ACCENT_GOLD : "#888"} />
                      <Text style={[styles.personTaskText, task.isCompleted && styles.personTaskTextCompleted, settings.compactMode && styles.textSmall]}>
                        {task.title}
                      </Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', gap: 12, marginStart: 10 }}>
                      <TouchableOpacity onPress={() => handleEditTask(task)}>
                        <FontAwesome name="edit" size={settings.compactMode ? 16 : 18} color={ACCENT_GOLD} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDeleteTask(task.id, task.title)}>
                        <FontAwesome name="trash" size={settings.compactMode ? 16 : 18} color="#ff4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>
        );
      }
      case 'order-card': {
        const po = item.po;
        const isSelected = selectedOrders.has(po.order.id);
        const threadLineStyle: any = {
          position: 'absolute',
          top: 0,
          bottom: item.isLastInThread ? '50%' : 0,
          width: 2,
          backgroundColor: '#333',
          ...(isRTL ? { right: 11 } : { left: 11 })
        };
        const contentPadding = isRTL 
          ? { paddingRight: settings.compactMode ? 28 : 32, marginRight: 0 }
          : { paddingLeft: settings.compactMode ? 28 : 32, marginLeft: 0 };

        return (
            <View style={[{ position: 'relative' }, contentPadding, { marginBottom: settings.compactMode ? 8 : 12 }]}>
              <View style={threadLineStyle} />
              <PersonOrderCard
                po={po}
                selectionMode={selectionMode}
                isSelected={isSelected}
                compactMode={settings.compactMode}
                isRTL={isRTL}
                t={t}
                onLongPress={(orderId) => {
                  if (!selectionMode) {
                    setSelectionMode(true);
                    setSelectedOrders(new Set([orderId]));
                  }
                }}
                onPress={(orderId) => {
                  if (selectionMode) {
                    toggleOrderSelection(orderId);
                  }
                }}
                onEdit={handleEditOrder}
                onDelete={handleDeleteOrder}
                onPayAmount={setPayAmountOrder}
                onMarkPaid={handleMarkAllPaid}
                onMarkUnpaid={handleMarkAllUnpaid}
                onUnknownPrice={setUnknownPricePerson}
                onHistory={setLogPerson}
              />
            </View>
        );
      }
      case 'empty-deliveries':
        return (
          <Text style={[styles.emptyText, settings.compactMode && styles.textSmall, { textAlign: 'center', marginTop: 20 }]}>
            {t('run.noDeliveries')}
          </Text>
        );
      case 'no-results':
        return (
          <View style={styles.noResultsContainer}>
            <FontAwesome name="search" size={48} color="#444" style={{ marginBottom: 10 }} />
            <Text style={styles.noResultsText}>{t('run.noOrdersFound', { query: searchQuery })}</Text>
          </View>
        );
      default:
        return null;
    }
  }, [
    isSearching,
    searchQuery,
    collapsedLocations,
    collapsedSources,
    selectedOrders,
    selectionMode,
    checkedItems,
    settings.compactMode,
    isRTL,
    t,
  ]);

  const toggleCheck = (itemId: string) => {
    setCheckedItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

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

    const { id: orderId, personId, total: orderTotal } = payAmountOrder;
    setPayAmountOrder(null);

    try {
      if (markAllPast) {
        await api.markAllOrdersPaidSilently(personId);
      } else {
        await api.markOrderPaid(orderId, personId);
      }

      const diff = markAllPast ? paidAmount : paidAmount - orderTotal;
      if (Math.abs(diff) > 0.001 || (markAllPast && paidAmount !== 0)) {
        const dateStr = getLocalDateString(targetDate);
        await api.changeBalance(personId, markAllPast ? paidAmount : diff, t('run.paymentAdjustment', { date: dateStr }));
      }
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), t('run.failedMarkPaid'));
    }
  };

  const handleCopyRun = async () => {
    let text = `🛒 RUN SUMMARY: ${formatDateLabel(targetDate, t, t('modals.daysShort'))}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    text += `🛍️ SHOPPING LIST\n`;
    Object.entries(aggregatedItems).forEach(([timingKey, sources]) => {
      if (settings.groupByFreshness && timingKey !== '_all') {
        text += `\n[ ${timingKey.toUpperCase()} ]\n`;
      }
      Object.entries(sources).forEach(([source, itemsList]) => {
        text += `\n📍 ${source}:\n`;
        itemsList.forEach(ag => {
          text += `  - ${ag.totalQuantity}x ${ag.item.name}`;
          if (ag.totalCost > 0) text += ` ($${ag.totalCost.toFixed(2)})`;
          else text += ` (Price TBD)`;
          text += `\n`;
        });
      });
    });

    text += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    text += `🚚 DELIVERIES & PAYMENTS\n`;
    peopleOrders.forEach(group => {
      text += `\n📍 ${group.location}\n`;
      group.orders.forEach(po => {
        text += `  👤 ${po.person.name}:\n`;
        if (po.items.length > 0) {
          po.items.forEach(i => {
            const cost = i.unitPrice !== null ? `$${(i.unitPrice * i.quantity).toFixed(2)}` : 'TBD';
            text += `    • ${i.quantity}x ${i.itemDef?.name} - ${cost} ${i.isPaid ? '✅' : '❌'}\n`;
          });
          text += `    Total: $${po.totalCost.toFixed(2)}${po.hasUnknownPriceItems ? ' + TBD' : ''}\n`;

          let balText = '';
          if (po.person.balance < 0) balText = `You are owed: $${Math.abs(po.person.balance).toFixed(2)}`;
          else if (po.person.balance > 0) balText = `You owe them: $${po.person.balance.toFixed(2)}`;
          else balText = po.hasUnknownPriceItems ? 'Awaiting Prices' : 'Settled';

          text += `    Balance: ${balText}\n`;
        }
        if (po.tasks && po.tasks.length > 0) {
          po.tasks.forEach((t: any) => {
            text += `    • [Task] ${t.title} ${t.isCompleted ? '✅' : '❌'}\n`;
          });
        }
      });
    });

    await Clipboard.setStringAsync(text);
    Alert.alert(t('run.copiedTitle'), t('run.copiedMsg'));
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
                await api.deleteOrder(orderId, true); // true = revertCash
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
                await api.deleteOrder(orderId, false); // false = keep credit
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

  const getSourceTotal = (itemsList: { totalCost: number }[]) => {
    return itemsList.reduce((sum, ag) => sum + ag.totalCost, 0);
  };

  const toggleSourceCollapse = (sourceKey: string) => {
    setCollapsedSources(prev => ({ ...prev, [sourceKey]: !prev[sourceKey] }));
  };

  const toggleLocationCollapse = (locKey: string) => {
    setCollapsedLocations(prev => ({ ...prev, [locKey]: !prev[locKey] }));
  };

  const toggleOrderSelection = (orderId: string) => {
    const next = new Set(selectedOrders);
    if (next.has(orderId)) {
      next.delete(orderId);
      if (next.size === 0) setSelectionMode(false);
    } else {
      next.add(orderId);
    }
    setSelectedOrders(next);
  };

  const handleDeleteSelected = () => {
    Alert.alert(
      t('run.deleteSelectedTitle'),
      t('run.deleteSelectedBody', { count: selectedOrders.size }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              for (const orderId of Array.from(selectedOrders)) {
                await api.deleteOrder(orderId);
              }
              setSelectionMode(false);
              setSelectedOrders(new Set());
            } catch (e) {
              console.error(e);
              Alert.alert(t('common.error'), t('run.failedDelete'));
            }
          },
        },
      ]
    );
  };

  const handleMoveSelected = async (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowMoveDatePicker(false);
    if (selectedDate && event.type === 'set') {
      try {
        const newDateStr = getLocalDateString(selectedDate);
        await api.moveOrdersToDate(Array.from(selectedOrders), newDateStr);
        setSelectionMode(false);
        setSelectedOrders(new Set());
        Alert.alert(t('common.success'), t('run.movedOrders', { count: selectedOrders.size, date: formatDateLabel(selectedDate, t, t('modals.daysShort')) }));
      } catch (e) {
        console.error(e);
        Alert.alert(t('common.error'), t('run.failedMove'));
      }
    }
  };

  const handlePrevDay = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    const d = new Date(targetDate);
    d.setDate(d.getDate() - 1);
    const newDateStr = getLocalDateString(d);
    const oldDateStr = getLocalDateString(targetDate);
    perfLog(`[PERF] [User Action] handlePrevDay initiated. Transition: ${oldDateStr} -> ${newDateStr}`);
    dateChangePerfRef.current = {
      date: newDateStr,
      startTime: performance.now(),
      prevDate: oldDateStr,
    };
    setTargetDate(d);
  };

  const handleNextDay = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    const d = new Date(targetDate);
    d.setDate(d.getDate() + 1);
    const newDateStr = getLocalDateString(d);
    const oldDateStr = getLocalDateString(targetDate);
    perfLog(`[PERF] [User Action] handleNextDay initiated. Transition: ${oldDateStr} -> ${newDateStr}`);
    dateChangePerfRef.current = {
      date: newDateStr,
      startTime: performance.now(),
      prevDate: oldDateStr,
    };
    setTargetDate(d);
  };

  const hasItems = Object.keys(aggregatedItems).length > 0 &&
    Object.values(aggregatedItems).some(sources => Object.keys(sources).length > 0);

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (isTransitioning) return;
    if (selectedDate) {
      setIsTransitioning(true);
      const newDateStr = getLocalDateString(selectedDate);
      const oldDateStr = getLocalDateString(targetDate);
      perfLog(`[PERF] [User Action] onDateChange initiated (DatePicker). Transition: ${oldDateStr} -> ${newDateStr}`);
      dateChangePerfRef.current = {
        date: newDateStr,
        startTime: performance.now(),
        prevDate: oldDateStr,
      };
      setTargetDate(selectedDate);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <View style={[styles.header, settings.compactMode && styles.headerCompact, { zIndex: 10 }]}>
        {!selectionMode ? (
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, settings.compactMode && styles.textSmall]}>{t('run.runLabel')}</Text>
            <View style={styles.dateNavRow}>
              <TouchableOpacity
                disabled={isTransitioning}
                onPress={handlePrevDay}
                style={[styles.navBtn, settings.compactMode && styles.paddingSmall, isTransitioning && { opacity: 0.5 }]}
              >
                <FontAwesome name={I18nManager.isRTL ? "chevron-right" : "chevron-left"} size={settings.compactMode ? 14 : 16} color="#888" />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={isTransitioning}
                onPress={() => setShowDatePicker(true)}
                style={[styles.dateDisplay, settings.compactMode && styles.dateDisplayCompact, isTransitioning && { opacity: 0.5 }]}
              >
                <Text style={[styles.dateDisplayText, settings.compactMode && styles.textSmall]}>{formatDateLabel(targetDate, t, t('modals.daysShort'))}</Text>
                <FontAwesome name="calendar" size={settings.compactMode ? 14 : 16} color={ACCENT_GOLD} />
              </TouchableOpacity>
              <TouchableOpacity
                disabled={isTransitioning}
                onPress={handleNextDay}
                style={[styles.navBtn, settings.compactMode && styles.paddingSmall, isTransitioning && { opacity: 0.5 }]}
              >
                <FontAwesome name={I18nManager.isRTL ? "chevron-left" : "chevron-right"} size={settings.compactMode ? 14 : 16} color="#888" />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => { setSelectionMode(false); setSelectedOrders(new Set()); }} style={[styles.copyBtn, settings.compactMode && styles.paddingSmall]}>
              <FontAwesome name="times" size={settings.compactMode ? 18 : 20} color="#888" />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, settings.compactMode && styles.textSmall]}>{selectedOrders.size} {t('run.selected')}</Text>
            <TouchableOpacity onPress={() => setShowMoveDatePicker(true)} style={[styles.copyBtn, { marginStart: 10 }, settings.compactMode && styles.paddingSmall]}>
              <FontAwesome name="calendar" size={settings.compactMode ? 18 : 20} color={ACCENT_GOLD} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDeleteSelected} style={[styles.copyBtn, settings.compactMode && styles.paddingSmall]}>
              <FontAwesome name="trash" size={settings.compactMode ? 18 : 20} color="#ff4444" />
            </TouchableOpacity>
          </View>
        )}
        {!selectionMode && (
          <View style={{ flexDirection: 'row', gap: 5 }}>
            <TouchableOpacity onPress={handleCopyRun} style={[styles.copyBtn, settings.compactMode && styles.paddingSmall]}>
              <FontAwesome name="copy" size={settings.compactMode ? 18 : 20} color={ACCENT_GOLD} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={targetDate}
          mode="date"
          display="default"
          onChange={onDateChange}
        />
      )}

      {showMoveDatePicker && (
        <DateTimePicker
          value={targetDate}
          mode="date"
          display="default"
          onChange={handleMoveSelected}
        />
      )}

      <FlatList
        data={flatListData}
        renderItem={renderFlatItem}
        keyExtractor={(item) => item.id}
        style={styles.container}
        contentContainerStyle={[styles.content, settings.compactMode && styles.contentCompact, { paddingBottom: 100 }]}
        keyboardShouldPersistTaps="handled"
      />

      {unknownPricePerson && (
        <UnknownPriceModal
          visible={!!unknownPricePerson}
          personId={unknownPricePerson.id}
          personName={unknownPricePerson.name}
          onClose={() => setUnknownPricePerson(null)}
        />
      )}

      {logPerson && (
        <CreditLogModal
          visible={!!logPerson}
          personId={logPerson.id}
          personName={logPerson.name}
          onClose={() => setLogPerson(null)}
        />
      )}

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#1a1a1a',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  dateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 10,
    flex: 1,
  },
  dateDisplayText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  headerTitle: { fontSize: 16, color: '#fff' },
  copyBtn: { padding: 10, marginStart: 5 },
  dateNavRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  navBtn: { padding: 8 },
  content: { padding: 15 },
  deliveriesHeader: {
    marginBottom: 15,
  },
  sectionTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTotal: { fontSize: 18, fontWeight: 'bold', color: ACCENT_GOLD },
  shoppingListStripOuter: {
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
  shoppingListStripInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 11,
    width: '100%',
  },
  generalTasksRow: {
    paddingHorizontal: 5,
    marginBottom: 15,
  },
  taskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  taskPillCompact: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  taskPillCompleted: {
    backgroundColor: '#2a2415',
    borderColor: ACCENT_GOLD,
  },
  taskPillText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  taskPillTextCompleted: {
    color: '#ccc',
    textDecorationLine: 'line-through',
  },
  taskPillTime: {
    color: ACCENT_GOLD,
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 5,
  },
  physicalChecklistContainer: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#333',
  },
  physicalChecklistTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: ACCENT_GOLD,
    marginBottom: 10,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  checklistRowCompact: {
    paddingVertical: 6,
  },
  checklistText: {
    fontSize: 16,
    color: '#fff',
  },
  checklistTextCompleted: {
    color: '#888',
    textDecorationLine: 'line-through',
  },
  personTasksContainer: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
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
    flexShrink: 1,
  },
  personTaskTextCompleted: {
    color: '#888',
    textDecorationLine: 'line-through',
  },
  shoppingListTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
  },
  shoppingListTotal: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
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
  locationGroup: { marginBottom: 25 },
  locationHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  deliveryLocationTitle: { fontSize: 18, fontWeight: 'bold', color: LIGHT_GOLD, marginStart: 8 },
  timingGroup: { marginBottom: 15 },
  timingTitle: { fontSize: 18, fontWeight: 'bold', color: ACCENT_GOLD, marginBottom: 5 },
  sourceGroup: {
    backgroundColor: '#222',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 15,
    padding: 12,
    overflow: 'hidden'
  },
  sourceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 8,
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
  sourceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourceTitle: { fontSize: 22, color: ACCENT_GOLD, fontWeight: 'bold' },
  sourceCost: { fontSize: 22, fontWeight: 'bold', color: ACCENT_GOLD },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  itemPriceContainer: { width: 60, alignItems: 'flex-end' },
  itemText: { fontSize: 16, color: '#fff' },
  itemPrice: { fontSize: 14, color: '#aaa', fontWeight: '500' },
  itemTextCrossed: { textDecorationLine: 'line-through', color: '#666' },
  quantityBadge: { backgroundColor: '#3d3522', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  quantityText: { color: '#eee', fontWeight: 'bold', fontSize: 12 },
  quantityBadgeCompact: { backgroundColor: '#3d3522', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  quantityTextCompact: { fontSize: 12 },
  quantityBadgeCrossed: { opacity: 0.7 },
  quantityTextCrossed: { color: '#666', textDecorationLine: 'line-through' },
  priceBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  priceText: { color: '#aaa', fontSize: 12 },
  emptyText: { color: '#888', fontStyle: 'italic', marginBottom: 20 },
  separator: { height: 1, backgroundColor: '#444', marginVertical: 20 },
  cardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  personCard: { backgroundColor: '#222', borderRadius: 10, marginBottom: 15, overflow: 'hidden', borderWidth: 1, borderColor: '#333' },
  personBody: { padding: 15 },
  personHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  personName: { fontSize: 18, fontWeight: 'bold', color: '#fff', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  personTotal: { fontSize: 18, fontWeight: 'bold', color: ACCENT_GOLD, textAlign: I18nManager.isRTL ? 'left' : 'right' },
  deliveryPlace: { fontSize: 12, color: LIGHT_GOLD, marginTop: 2, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  costInfo: { alignItems: 'flex-end', flex: 1 },
  orderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editOrderBtn: { padding: 4 },
  deleteOrderBtn: { padding: 4 },
  statusContainer: { height: 20, justifyContent: 'center' },
  statusText: { fontSize: 12, fontWeight: 'bold' },
  statusUnpaid: { color: '#ffa726' },
  statusPaid: { color: '#5c8a6a' },
  personItems: { marginBottom: 10 },
  itemRow2: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  itemToggle: { padding: 8 },
  itemInfo: { flex: 1 },
  personItemText: { color: '#ccc', fontSize: 14, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  personItemPaid: { textDecorationLine: 'line-through', color: '#666' },
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
  markAllPaidBtn: {},
  markAllPaidText: { color: '#1a1a1a', fontWeight: 'bold', fontSize: 13 },
  payAmountBtn: {},
  markAllUnpaidBtn: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#444',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  markAllUnpaidText: { color: ACCENT_GOLD, fontWeight: 'bold', fontSize: 13 },

  // Compact Modifiers
  headerCompact: { padding: 8 },
  dateDisplayCompact: { paddingVertical: 4, paddingHorizontal: 8 },
  contentCompact: { padding: 8 },
  sectionTitleCompact: { fontSize: 18, marginBottom: 5 },
  timingTitleCompact: { fontSize: 15, marginBottom: 3 },
  sourceGroupCompact: { padding: 10, marginBottom: 8 },
  sourceHeaderCompact: { marginBottom: 5 },
  sourceTitleCompact: { fontSize: 15 },
  itemRowCompact: { marginBottom: 2 },
  itemTextCompact: { fontSize: 14 },
  deliveriesHeaderCompact: { marginBottom: 8 },
  searchInputCompact: { paddingVertical: 6, fontSize: 14 },
  locationGroupCompact: { marginBottom: 15 },
  locationHeaderRowCompact: { marginBottom: 6 },
  deliveryLocationTitleCompact: { fontSize: 16 },
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
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  noResultsText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '500',
  },
  personHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  personHeaderRowCompact: {
    paddingVertical: 6,
  },
  personHeaderText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  personHeaderTextCompact: {
    fontSize: 16,
  },
  taskCardContainer: {
    backgroundColor: '#222',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ACCENT_GOLD,
    padding: 12,
    overflow: 'hidden',
  },
  taskCardContainerCompact: {
    padding: 8,
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  taskCardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: ACCENT_GOLD,
  },
  markAllCompleteBtn: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  markAllCompleteText: {
    color: ACCENT_GOLD,
    fontSize: 13,
    fontWeight: 'bold',
  },
  orderCreatedAt: { color: '#888', fontSize: 12 },
  orderCreatedAtCompact: { fontSize: 10 },
});

// ==========================================
// MEMOIZED PERFORMANCE-OPTIMIZED SUBCOMPONENTS
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
    <View style={[styles.itemRow2, compactMode && styles.itemRow2Compact]}>
      <View style={[styles.itemInfo, { alignItems: 'center', flexDirection: 'row', gap: 8, flexShrink: 1, overflow: 'hidden' }]}>
        <View style={[styles.quantityBadge, compactMode && styles.quantityBadgeCompact, item.isPaid && styles.quantityBadgeCrossed]}>
          <Text style={[styles.quantityText, compactMode && styles.quantityTextCompact, item.isPaid && styles.quantityTextCrossed]}>
            x{item.quantity}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.itemText, { flexShrink: 1, marginStart: 0 }, compactMode && styles.textExtraSmall, item.isPaid && styles.personItemPaid]}>
          {isRTL ? '\u200F' : ''}{item.itemDef?.name}
        </Text>
      </View>
      <View style={styles.itemPriceContainer}>
        {item.unitPrice === null ? (
          <Text style={[styles.itemPrice, { color: '#ffeb3b', fontStyle: 'italic' }, compactMode && styles.textExtraSmall]}>{t('common.priceTBD')}</Text>
        ) : itemCost > 0 ? (
          <Text style={[styles.itemPrice, compactMode && styles.textExtraSmall, item.isPaid && styles.personItemPaid]}>${itemCost.toFixed(2)}</Text>
        ) : null}
      </View>
    </View>
  );
});

interface PersonOrderCardProps {
  po: any;
  selectionMode: boolean;
  isSelected: boolean;
  compactMode: boolean;
  isRTL: boolean;
  t: (key: string, params?: any) => string;
  onLongPress: (orderId: string) => void;
  onPress: (orderId: string) => void;
  onEdit: (order: any, person: any) => void;
  onDelete: (orderId: string, personName: string, isPaid: boolean) => void;
  onPayAmount: (payInfo: { id: string; personId: string; total: number; personName: string }) => void;
  onMarkPaid: (orderId: string, personId: string) => void;
  onMarkUnpaid: (orderId: string, personId: string) => void;
  onUnknownPrice: (personInfo: { id: string; name: string }) => void;
  onHistory: (personInfo: { id: string; name: string }) => void;
}

const PersonOrderCard = React.memo(function PersonOrderCard({
  po,
  selectionMode,
  isSelected,
  compactMode,
  isRTL,
  t,
  onLongPress,
  onPress,
  onEdit,
  onDelete,
  onPayAmount,
  onMarkPaid,
  onMarkUnpaid,
  onUnknownPrice,
  onHistory,
}: PersonOrderCardProps) {
  return (
    <View style={styles.cardShadow}>
      <View style={[styles.personCard, compactMode && styles.personCardCompact, selectionMode && isSelected && { borderColor: ACCENT_GOLD, borderWidth: 1 }]}>
        <View style={[styles.personBody, compactMode && styles.personBodyCompact]}>
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={() => onLongPress(po.order.id)}
            onPress={() => onPress(po.order.id)}
            style={[styles.personHeader, compactMode && styles.personHeaderCompact, selectionMode && isSelected && { backgroundColor: 'rgba(47, 149, 220, 0.15)' }]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', flex: 1 }}>
                {selectionMode && (
                  <FontAwesome
                    name={isSelected ? 'check-square-o' : 'square-o'}
                    size={compactMode ? 20 : 24}
                    color={isSelected ? ACCENT_GOLD : '#888'}
                    style={{ marginEnd: 10, marginTop: 2 }}
                  />
                )}
                <View style={{ flex: 1, alignItems: 'flex-start', overflow: 'hidden', paddingEnd: 8, gap: 2 }}>
                  <Text style={[styles.personTotal, compactMode && styles.personTotalCompact, { textAlign: isRTL ? 'right' : 'left' }]}>
                    ${po.totalCost.toFixed(2)}{po.hasUnknownPriceItems ? ` + ${t('common.priceTBD')}` : ''}
                  </Text>
                  <View style={[styles.statusContainer, compactMode && { height: 16 }]}>
                    <Text style={[styles.statusText, po.unpaidCost > 0 ? styles.statusUnpaid : styles.statusPaid, compactMode && styles.textExtraSmall, { textAlign: isRTL ? 'right' : 'left' }]}>
                      {po.hasUnknownPriceItems ? t('run.statusAwaitingPrices') : po.unpaidCost > 0 ? t('run.statusUnpaid') : t('run.statusPaid')}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <FontAwesome name="clock-o" size={compactMode ? 10 : 12} color="#888" />
                    <Text style={[styles.orderCreatedAt, compactMode && styles.orderCreatedAtCompact]}>
                      {" "}{t('modals.created')}: {po.order.createdAt ? formatDateTime(po.order.createdAt, isRTL ? 'ar' : 'en') : t('modals.notAvailable')}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={[styles.costInfo, { alignItems: isRTL ? 'flex-start' : 'flex-end', flex: 0 }]}>
                <View style={styles.orderActions}>
                  {!selectionMode && (
                    <View style={{ flexDirection: 'row', gap: 15 }}>
                      <TouchableOpacity onPress={() => onEdit(po.order, po.person)} style={styles.editOrderBtn}>
                        <FontAwesome name="edit" size={compactMode ? 14 : 16} color={ACCENT_GOLD} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => onDelete(po.order.id, po.person.name, po.order.isPaid)} style={styles.deleteOrderBtn}>
                        <FontAwesome name="trash" size={compactMode ? 14 : 16} color="#ff4444" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </TouchableOpacity>

          <View style={styles.personItems}>
            {po.items.map((i: any) => (
              <OrderItemRow
                key={i.id}
                item={i}
                compactMode={compactMode}
                isRTL={isRTL}
                t={t}
              />
            ))}
          </View>
        </View>

        <View style={[
          styles.personFooter,
          compactMode && styles.personFooterCompact,
          po.person.balance < 0 ? styles.footerDebt : po.person.balance > 0 ? styles.footerCredit : null
        ]}>
          <View>
            <View style={styles.balanceHeaderRow}>
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
            </View>
            <View style={styles.balanceValueRow}>
              <Text style={[po.person.balance < 0 ? styles.debt : po.person.balance > 0 ? styles.credit : po.hasUnknownPriceItems ? styles.pending : styles.settled, compactMode && styles.personTotalCompact]}>
                ${Math.abs(po.person.balance).toFixed(2)}
              </Text>
              <TouchableOpacity
                onPress={() => onHistory({ id: po.person.id, name: po.person.name })}
                style={[styles.historyBtn, compactMode && styles.paddingSmall]}
              >
                <FontAwesome name="history" size={compactMode ? 14 : 16} color={ACCENT_GOLD} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.buttonGroup}>
            {po.hasUnpaidItems ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => onPayAmount({ id: po.order.id, personId: po.person.id, total: po.totalCost, personName: po.person.name })}>
                  <View style={styles.paymentShadow}>
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
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onMarkPaid(po.order.id, po.person.id)}>
                  <View style={styles.paymentShadow}>
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
                  </View>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.markAllUnpaidBtn, compactMode && styles.compactBtn]}
                onPress={() => onMarkUnpaid(po.order.id, po.person.id)}>
                <Text style={[styles.markAllUnpaidText, compactMode && styles.textExtraSmall]}>{t('run.revertLastPayment')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
});

interface SourceGroupCardProps {
  source: string;
  itemsList: any[];
  sourceTotal: number;
  isCollapsed: boolean;
  checkedItems: Record<string, boolean>;
  compactMode: boolean;
  isRTL: boolean;
  onToggleCollapse: () => void;
  onToggleCheck: (itemId: string) => void;
}

const SourceGroupCard = React.memo(function SourceGroupCard({
  source,
  itemsList,
  sourceTotal,
  isCollapsed,
  checkedItems,
  compactMode,
  isRTL,
  onToggleCollapse,
  onToggleCheck,
}: SourceGroupCardProps) {
  return (
    <View style={styles.cardShadow}>
      <View style={[styles.sourceGroup, compactMode && styles.sourceGroupCompact]}>
        <TouchableOpacity
          style={[styles.sourceHeader, compactMode && styles.sourceHeaderCompact]}
          onPress={onToggleCollapse}
          activeOpacity={0.7}>
          <View style={[styles.sourceTitleRow, { flex: 1 }]}>
            <FontAwesome
              name={isCollapsed ? 'caret-right' : 'caret-down'}
              size={compactMode ? 14 : 16}
              color="#888"
              style={{ width: 15 }}
            />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.sourceTitle, compactMode && styles.sourceTitleCompact, { flex: 1 }]}>
              📍 {source}
            </Text>
          </View>
          <Text style={[styles.sourceCost, compactMode && styles.sourceTitleCompact]}>${sourceTotal.toFixed(2)}</Text>
        </TouchableOpacity>

        {!isCollapsed && itemsList.map((ag) => (
          <TouchableOpacity
            key={ag.item.id}
            style={[styles.itemRow, compactMode && styles.itemRowCompact]}
            onPress={() => onToggleCheck(ag.item.id)}>
            <FontAwesome
              name={checkedItems[ag.item.id] ? 'check-square' : 'square-o'}
              size={compactMode ? 20 : 24}
              color={ACCENT_GOLD}
            />
            <View style={{ flex: 1, alignItems: 'center', flexDirection: 'row', gap: 8, overflow: 'hidden', marginStart: 10 }}>
              <View style={[styles.quantityBadge, compactMode && styles.quantityBadgeCompact, checkedItems[ag.item.id] && styles.quantityBadgeCrossed]}>
                <Text style={[styles.quantityText, compactMode && styles.quantityTextCompact, checkedItems[ag.item.id] && styles.quantityTextCrossed]}>
                  x{ag.totalQuantity}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.itemText,
                  compactMode && styles.itemTextCompact,
                  checkedItems[ag.item.id] && styles.itemTextCrossed,
                  { flexShrink: 1, marginStart: 0 }
                ]}>
                {isRTL ? '\u200F' : ''}{ag.item.name}
              </Text>
            </View>
            <View style={styles.itemPriceContainer}>
              {ag.totalCost > 0 && (
                <Text style={[
                  styles.itemPrice,
                  compactMode && styles.textSmall,
                  checkedItems[ag.item.id] && styles.itemTextCrossed,
                ]}>
                  ${ag.totalCost.toFixed(2)}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
});
