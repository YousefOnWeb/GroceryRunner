import CreditLogModal from '@/components/CreditLogModal';
import PersonOrdersModal from '@/components/PersonOrdersModal';
import SettleUpModal from '@/components/SettleUpModal';
import { Text, View } from '@/components/Themed';
import UnknownPriceModal from '@/components/UnknownPriceModal';
import { db } from '@/db';
import { api } from '@/db/api';
import { items, orderItems, orders, persons, tasks } from '@/db/schema';
import { formatDateLabel, formatDateTime, generateDateOptions, getDefaultDate, getLocalDateString } from '@/utils/dates';
import { useTranslation } from '@/utils/i18n';
import { useSettings } from '@/utils/settings';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { ACCENT_GOLD, LIGHT_GOLD, LIQUID_GOLD_STOPS, LIQUID_SILVER_STOPS, METALLIC_BEVEL, SILVER_BEVEL } from '@/constants/Colors';
// -----------------------
import { useIsFocused } from '@react-navigation/native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, I18nManager, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, TextInput } from 'react-native';

const HighlightText = ({ text, highlight, style, numberOfLines, ellipsizeMode }: { text: string; highlight?: string; style?: any; numberOfLines?: number; ellipsizeMode?: any }) => {
  if (!highlight || !highlight.trim()) {
    return <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>{text}</Text>;
  }
  const regex = new RegExp(`(${highlight.trim().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <Text key={i} style={{ backgroundColor: 'rgba(255, 215, 0, 0.4)', color: '#fff' }}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
};

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
  const [searchQuery, setSearchQuery] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [optimisticTasks, setOptimisticTasks] = useState<Record<string, boolean>>({});
  const [paidItems, setPaidItems] = useState<Record<string, boolean>>({});

  // Unknown price notes modal
  const [unknownPricePerson, setUnknownPricePerson] = useState<{ id: string; name: string } | null>(null);

  // Credit log modal
  const [logPerson, setLogPerson] = useState<{ id: string; name: string } | null>(null);

  // Past orders modal
  const [ordersPerson, setOrdersPerson] = useState<{ id: string; name: string } | null>(null);

  // Collapsible states
  const [collapsedSources, setCollapsedSources] = useState<Record<string, boolean>>({});
  const [collapsedLocations, setCollapsedLocations] = useState<Record<string, boolean>>({});
  const [activeLocation, setActiveLocation] = useState<string | null>(null);
  const [activePerson, setActivePerson] = useState<any>(null);

  const locationYPositions = useRef<{ [id: string]: number }>({});
  const personYPositions = useRef<{ [id: string]: number }>({});
  const locationHeaderHeight = useRef(45);
  const activeLocationRef = useRef<string | null>(null);
  const activePersonRef = useRef<any>(null);

  const itemHeights = useRef<{ [id: string]: number }>({});
  const needsYRecompute = useRef(true);

  const handleItemLayout = React.useCallback((id: string, height: number) => {
    if (Math.abs((itemHeights.current[id] || 0) - height) > 1) {
      itemHeights.current[id] = height;
      needsYRecompute.current = true;
    }
  }, []);

  useEffect(() => {
    setActiveLocation(null);
    setActivePerson(null);
    activeLocationRef.current = null;
    activePersonRef.current = null;
    locationYPositions.current = {};
    personYPositions.current = {};
  }, [targetDate]);

  const router = useRouter();

  // Multi-select mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [showMoveDatePicker, setShowMoveDatePicker] = useState(false);
  const [payAmountOrder, setPayAmountOrder] = useState<{ id: string; personId: string; total: number; personName: string; date: string; currentBalance: number } | null>(null);

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
    })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(eq(orders.targetDate, targetDateDb)),
    [targetDateDb]
  );
  const { data: catalog } = useLiveQuery(db.select().from(items));
  const { data: people } = useLiveQuery(db.select().from(persons));
  const { data: allTasks } = useLiveQuery(db.select().from(tasks));

  const isFocused = useIsFocused();
  const lastAggregatedRef = useRef<{
    aggregatedItems: Record<string, Record<string, any[]>>;
    peopleOrders: any[];
    listTotal: number;
    generalTasks: any[];
    physicalChecklist: any[];
  } | null>(null);

  type AggregatedItemsType = Record<string, Record<string, any[]>>;
  type PeopleOrdersType = { location: string; orders: any[] }[];

  const { aggregatedItems, peopleOrders, listTotal, generalTasks, physicalChecklist } = useMemo<{
    aggregatedItems: AggregatedItemsType;
    peopleOrders: PeopleOrdersType;
    listTotal: number;
    generalTasks: any[];
    physicalChecklist: any[];
  }>(() => {
    if (!isFocused && lastAggregatedRef.current) {
      return lastAggregatedRef.current!;
    }

    const memoStart = performance.now();
    const agg: Record<string, { item: any; totalQuantity: number; totalCost: number }> = {};
    const pOrders: Record<string, { person: any; order: any; items: any[]; tasks: any[]; totalCost: number; unpaidCost: number; hasUnpaidItems: boolean; hasUnknownPriceItems: boolean; deliveryPlace: string | null; searchBlob: string; showOrder?: boolean; showTasks?: boolean }> = {};

    if (!allOrders || !allOrderItems || !catalog || !people || !allTasks) {
      perfLog(`[PERF] [useMemo] DB tables not fully loaded yet inside Render #${renderCountRef.current}`);
      const fallback = { aggregatedItems: {}, peopleOrders: [], listTotal: 0, generalTasks: [], physicalChecklist: [] };
      lastAggregatedRef.current = fallback;
      return fallback;
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
      const searchStrings: string[] = [];
      if (person) searchStrings.push(person.name);
      const place = order.deliveryPlace || (person ? person.typicalPlace : null);
      if (place) searchStrings.push(place);

      const orderDetails = itemsForOrder.map((oi) => {
        const itemDef = catalog.find((c) => c.id === oi.itemId);
        const cost = (oi.unitPrice ?? 0) * oi.quantity;
        totalCost += cost;

        if (!order.isSettled) {
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
          searchStrings.push(itemDef.name);
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
          deliveryPlace: order.deliveryPlace || person.typicalPlace,
          searchBlob: searchStrings.join(' ').toLowerCase()
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
            deliveryPlace: t.locationPlace || person.typicalPlace,
            searchBlob: `${person.name} ${t.locationPlace || person.typicalPlace || ''}`.toLowerCase()
          };
        }
        pOrders[person.id].tasks.push(t);
        pOrders[person.id].searchBlob += ' ' + (t.title || '').toLowerCase();
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

    const result = {
      aggregatedItems: groupedList,
      peopleOrders: sortedLocations.map(loc => ({
        location: loc,
        orders: groupedDeliveries[loc] || []
      })),
      listTotal,
      generalTasks,
      physicalChecklist,
    };
    lastAggregatedRef.current = result;
    return result;
  }, [allOrders, allOrderItems, catalog, people, allTasks, targetDate, settings.groupByFreshness, settings.locationOrder, settings.sourceOrder, isFocused]);

  const lastFlatListRef = useRef<any[]>(null);

  const flatListData = useMemo<any[]>(() => {
    if (!isFocused && lastFlatListRef.current) {
      return lastFlatListRef.current!;
    }

    needsYRecompute.current = true;
    const listStart = performance.now();
    const list: any[] = [];

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

    list.push({ type: 'deliveries-header', id: 'deliveries-header' });

    peopleOrders.forEach((group) => {
      let filteredOrders = group.orders;
      const query = searchQuery.trim().toLowerCase();

      if (query) {
        filteredOrders = group.orders.map(po => {
          const personNameMatches = po.person.name.toLowerCase().includes(query);
          const locMatches = (po.deliveryPlace || '').toLowerCase().includes(query);

          let orderMatches = personNameMatches || locMatches;
          if (!orderMatches) {
             orderMatches = po.items.some((i: any) => (i.itemDef?.name || '').toLowerCase().includes(query));
          }

          let taskMatches = personNameMatches || locMatches;
          if (!taskMatches) {
             taskMatches = po.tasks.some((t: any) => (t.title || '').toLowerCase().includes(query));
          }

          if (orderMatches || taskMatches) {
            return {
              ...po,
              showOrder: orderMatches || po.items.length === 0,
              showTasks: taskMatches || po.tasks.length === 0
            };
          }
          return null;
        }).filter(Boolean);
      }

      if (filteredOrders.length === 0) return;

      list.push({
        type: 'location-header',
        id: `location-${group.location}`,
        location: group.location,
      });

      const isCollapsed = collapsedLocations[group.location];
      if (!isCollapsed) {
        filteredOrders.forEach((po: any, index: number) => {
          // 1. Person Header
          list.push({
            type: 'person-header',
            id: `person-header-${po.person.id}-${po.order.id}`,
            person: po.person,
            deliveryPlace: po.deliveryPlace
          });

          const hasTasks = po.tasks && po.tasks.length > 0 && (!query || po.showTasks);
          const hasOrder = po.items && po.items.length > 0 && (!query || po.showOrder);
          
          if (!hasTasks && !hasOrder) return;

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
              isLastInThread: true
            });
          }
        });
      }
    });

    if (peopleOrders.length === 0) {
      list.push({ type: 'empty-deliveries', id: 'empty-deliveries' });
    }

    const listEnd = performance.now();
    perfLog(`[PERF] [flatListData useMemo] Completed in ${(listEnd - listStart).toFixed(2)}ms, generated ${list.length} items.`);
    lastFlatListRef.current = list;
    return list;
  }, [
    listTotal,
    aggregatedItems,
    settings.groupByFreshness,
    peopleOrders,
    collapsedLocations,
    collapsedSources,
    isFocused,
    selectedOrders,
    selectionMode,
    checkedItems,
    optimisticTasks,
    generalTasks,
    physicalChecklist,
    searchQuery,
  ]);

  const handleScroll = React.useCallback((e: any) => {
    if (needsYRecompute.current) {
      let currentY = 0;
      let newLocY: { [id: string]: number } = {};
      let newPersY: { [id: string]: number } = {};

      for (let i = 0; i < flatListData.length; i++) {
        const item = flatListData[i];
        if (item.type === 'location-header') {
          newLocY[item.location] = currentY;
        } else if (item.type === 'person-header') {
          newPersY[item.person.id] = currentY;
        }

        let h = itemHeights.current[item.id];
        if (h === undefined) {
          if (item.type === 'location-header') h = 45;
          else if (item.type === 'person-header') h = 45;
          else if (item.type === 'deliveries-header') h = 45;
          else if (item.type === 'separator') h = 20;
          else if (item.type === 'shopping-header') h = 100;
          else if (item.type === 'shopping-source') h = 60;
          else if (item.type === 'order-card') h = 100;
          else h = 50;
        }
        currentY += h;
      }

      locationYPositions.current = newLocY;
      personYPositions.current = newPersY;
      needsYRecompute.current = false;
    }

    const scrollY = Math.max(0, e.nativeEvent.contentOffset.y);

    let currentLoc: string | null = null;
    let maxLocY = -1;
    for (const [loc, y] of Object.entries(locationYPositions.current)) {
      if (y <= scrollY + 1 && y > maxLocY) {
        maxLocY = y;
        currentLoc = loc;
      }
    }

    let currentPers: string | null = null;
    let maxPersY = -1;
    for (const [id, y] of Object.entries(personYPositions.current)) {
      if (y <= scrollY + locationHeaderHeight.current + 1 && y > maxPersY) {
        maxPersY = y;
        currentPers = id;
      }
    }

    if (currentLoc !== activeLocationRef.current) {
      activeLocationRef.current = currentLoc;
      setActiveLocation(currentLoc);
    }

    if (currentPers !== activePersonRef.current?.id) {
      if (currentPers === null) {
        activePersonRef.current = null;
        setActivePerson(null);
      } else {
        const p = flatListData.find((i: any) => i.type === 'person-header' && i.person.id === currentPers)?.person;
        if (p) {
          activePersonRef.current = p;
          setActivePerson(p);
        }
      }
    }
  }, [flatListData]);

  const toggleTaskStatus = React.useCallback(async (taskId: string, currentStatus: boolean, taskTargetDate?: string | null) => {
    perfLog(`[PERF] [Interaction] toggleTaskStatus called for taskId: ${taskId}`);
    const start = performance.now();
    const newStatus = !currentStatus;
    setOptimisticTasks(prev => ({ ...prev, [taskId]: newStatus }));
    perfLog(`[PERF] [Interaction] toggleTaskStatus optimistic UI updated in ${(performance.now() - start).toFixed(2)}ms`);

    try {
      const updates: any = { isCompleted: newStatus };
      if (!currentStatus && !taskTargetDate) {
        updates.targetDate = getLocalDateString(targetDate);
      }
      await api.updateTask(taskId, updates);
    } catch (e) {
      console.error(e);
      setOptimisticTasks(prev => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      Alert.alert(t('common.error'), 'Failed to toggle task status');
    }
  }, [targetDate, t]);

  const handleEditTask = React.useCallback((task: any) => {
    router.push({ pathname: '/add-order', params: { editTaskId: task.id } });
  }, [router]);

  const handleDeleteTask = React.useCallback((taskId: string, title: string) => {
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
  }, [t]);

  const handleTaskLongPress = React.useCallback((task: any) => {
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
  }, [handleEditTask, handleDeleteTask, t]);

  const renderFlatItem = React.useCallback(({ item }: { item: any }) => {
    perfLog(`[PERF] [RenderItem called] Render #${currentRender} - type=${item.type} id=${item.id}`);
    const content = (() => {
      switch (item.type) {
        case 'general-tasks':
          return (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.generalTasksRow} contentContainerStyle={{ gap: 10 }}>
              {item.tasks.map((task: any) => {
                const isCompleted = optimisticTasks[task.id] !== undefined ? optimisticTasks[task.id] : task.isCompleted;
                return (
                  <MemoizedTaskPill
                    key={task.id}
                    task={task}
                    isCompleted={isCompleted}
                    compactMode={settings.compactMode}
                    onToggle={toggleTaskStatus}
                    onLongPress={handleTaskLongPress}
                  />
                );
              })}
            </ScrollView>
          );
        case 'physical-checklist':
          return (
            <View style={styles.physicalChecklistContainer}>
              <Text style={[styles.physicalChecklistTitle, settings.compactMode && styles.textSmall]}>{t('tasks.physicalChecklist') || 'Physical Tasks Checklist'}</Text>
              {item.tasks.map((task: any) => {
                const isCompleted = optimisticTasks[task.id] !== undefined ? optimisticTasks[task.id] : task.isCompleted;
                return (
                  <MemoizedPhysicalTaskRow
                    key={task.id}
                    task={task}
                    isCompleted={isCompleted}
                    compactMode={settings.compactMode}
                    onToggle={toggleTaskStatus}
                    onLongPress={handleTaskLongPress}
                  />
                );
              })}
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
              sourceKey={item.sourceKey}
              itemsList={item.itemsList}
              sourceTotal={sourceTotal}
              isCollapsed={isCollapsed}
              checkedItems={checkedItems}
              compactMode={settings.compactMode}
              isRTL={isRTL}
              onToggleCollapse={toggleSourceCollapse}
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
              <View style={{ position: 'relative', justifyContent: 'center' }}>
                <TextInput
                  style={[
                    styles.searchInput,
                    settings.compactMode && styles.searchInputCompact,
                    {
                      textAlign: isRTL ? 'right' : 'left',
                      paddingRight: isRTL ? 12 : 35,
                      paddingLeft: isRTL ? 35 : 12,
                    }
                  ]}
                  placeholder={t('run.searchPlaceholder')}
                  placeholderTextColor="#888"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    style={{ position: 'absolute', right: isRTL ? undefined : 12, left: isRTL ? 12 : undefined }}
                    onPress={() => setSearchQuery('')}
                  >
                    <FontAwesome name="times-circle" size={settings.compactMode ? 16 : 18} color="#888" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        case 'location-header': {
          const isCollapsed = collapsedLocations[item.location];
          return (
            <View style={{ backgroundColor: '#1a1a1a', paddingBottom: 10 }}>
              <TouchableOpacity
                style={[styles.locationHeaderRow, settings.compactMode && styles.locationHeaderRowCompact, { marginBottom: 0, borderBottomWidth: 0 }]}
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
            </View>
          );
        }
        case 'person-header': {
          return (
            <View style={{ backgroundColor: '#1a1a1a', paddingBottom: 10 }}>
              <View style={[styles.personHeaderRow, settings.compactMode && styles.personHeaderRowCompact, { marginBottom: 0, borderBottomWidth: 0, paddingBottom: 0 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <FontAwesome name="user" size={settings.compactMode ? 14 : 16} color={ACCENT_GOLD} style={{ width: 24, textAlign: 'center' }} />
                  <HighlightText
                    text={item.person.name}
                    highlight={searchQuery}
                    style={[styles.personHeaderText, settings.compactMode && styles.personHeaderTextCompact, { flex: 1 }]}
                  />
                </View>
                <TouchableOpacity onPress={() => handlePayAmountRequest({ id: '', personId: item.person.id, total: 0, personName: item.person.name, targetDate: '', currentBalance: item.person.balance })} style={styles.paymentShadow}>
                  <LinearGradient colors={METALLIC_BEVEL} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.paymentBtnOuter}>
                    <LinearGradient colors={LIQUID_GOLD_STOPS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.paymentBtnInner}>
                      <Text style={[styles.markAllPaidText, settings.compactMode && { fontSize: 10 }]}>{t('run.receivePaymentTitle')}</Text>
                    </LinearGradient>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          );
        }
        case 'task-card': {
          const po = item.po;
          const threadLineStyle: any = {
            position: 'absolute',
            top: 0,
            bottom: item.isLastInThread ? '50%' : -(settings.compactMode ? 8 : 12),
            width: 2,
            backgroundColor: '#333',
            left: 11
          };
          const dotStyle: any = {
            position: 'absolute',
            top: '50%',
            left: 8,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: '#333',
            marginTop: -4,
            zIndex: 1
          };
          const contentPadding = { paddingLeft: settings.compactMode ? 28 : 32 };

          return (
            <View style={[{ position: 'relative' }, contentPadding, { marginBottom: settings.compactMode ? 8 : 12 }]}>
              <View style={threadLineStyle} />
              <View style={dotStyle} />
              <View style={[styles.taskCardContainer, settings.compactMode && styles.taskCardContainerCompact]}>
                <View style={styles.taskCardHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <FontAwesome name="list-ul" size={14} color={ACCENT_GOLD} style={{ marginEnd: 6 }} />
                    <Text style={styles.taskCardTitle}>{t('tasks.otherMeetupTasks') || 'Meetup Tasks'}</Text>
                  </View>
                </View>
                <View style={styles.personTasksContainer}>
                  {po.tasks.map((task: any) => {
                    const isCompleted = optimisticTasks[task.id] !== undefined ? optimisticTasks[task.id] : task.isCompleted;
                    return (
                      <MemoizedPersonTaskRow
                        key={task.id}
                        task={task}
                        isCompleted={isCompleted}
                        compactMode={settings.compactMode}
                        searchQuery={searchQuery}
                        onToggle={toggleTaskStatus}
                        onLongPress={handleTaskLongPress}
                        onEdit={handleEditTask}
                        onDelete={handleDeleteTask}
                      />
                    );
                  })}
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
            bottom: item.isLastInThread ? '50%' : -(settings.compactMode ? 8 : 12),
            width: 2,
            backgroundColor: '#333',
            left: 11
          };
          const dotStyle: any = {
            position: 'absolute',
            top: '50%',
            left: 8,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: '#333',
            marginTop: -4,
            zIndex: 1
          };
          const contentPadding = { paddingLeft: settings.compactMode ? 28 : 32 };

          return (
            <View style={[{ position: 'relative' }, contentPadding, { marginBottom: settings.compactMode ? 8 : 12 }]}>
              <View style={threadLineStyle} />
              <View style={dotStyle} />
              <PersonOrderCard
                po={po}
                selectionMode={selectionMode}
                isSelected={isSelected}
                compactMode={settings.compactMode}
                isRTL={isRTL}
                t={t}
                searchQuery={searchQuery}
                onLongPress={handleOrderLongPress}
                onPress={handleOrderPress}
                onEdit={handleEditOrder}
                onDelete={handleDeleteOrder}
                onPayAmount={handlePayAmountRequest}
                onMarkPaid={handleMarkAllPaid}
                onMarkUnpaid={handleMarkAllUnpaid}
                onUnknownPrice={setUnknownPricePerson}
                onHistory={setLogPerson}
                onOrdersClick={setOrdersPerson}
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
        default:
          return null;
      }
    })();

    return (
      <View onLayout={(e) => handleItemLayout(item.id, e.nativeEvent.layout.height)}>
        {content}
      </View>
    );
  }, [
    collapsedLocations,
    collapsedSources,
    selectedOrders,
    selectionMode,
    checkedItems,
    optimisticTasks,
    settings.compactMode,
    isRTL,
    t,
    searchQuery,
  ]);

  const toggleCheck = React.useCallback((itemId: string) => {
    perfLog(`[PERF] [Interaction] toggleCheck called for itemId: ${itemId}`);
    const start = performance.now();
    setCheckedItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
    perfLog(`[PERF] [Interaction] toggleCheck state update triggered in ${(performance.now() - start).toFixed(2)}ms`);
  }, []);

  const handlePayAmountRequest = React.useCallback((payInfo: { id: string; personId: string; total: number; personName: string; targetDate: string; currentBalance: number }) => {
    setPayAmountOrder({ ...payInfo, date: payInfo.targetDate });
  }, []);

  const handleMarkAllPaid = React.useCallback(async (orderId: string, personId: string) => {
    try {
      await api.markOrderSettled(orderId, true);
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), 'Failed to mark order as settled.');
    }
  }, [t]);

  const handleMarkAllUnpaid = React.useCallback(async (orderId: string, personId: string) => {
    try {
      await api.markOrderSettled(orderId, false);
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), 'Failed to mark order as unsettled.');
    }
  }, [t]);

  const handleCustomPayment = async (amount: number, note: string, markSettled?: boolean, markAllPastSettled?: boolean) => {
    if (!payAmountOrder) return;
    try {
      console.log('\n==================================================');
      console.log(`[PAYMENT DEBUG - index] Starting payment flow for ${payAmountOrder.personName}`);
      console.log(`[PAYMENT DEBUG - index] Amount: ${amount}, Note: ${note}, markSettled: ${markSettled}, markAllPastSettled: ${markAllPastSettled}`);
      const startTime = performance.now();

      console.log(`[PAYMENT DEBUG - index] Calling api.receivePayment...`);
      let stepStart = performance.now();
      await api.receivePayment(payAmountOrder.personId, amount, note);
      console.log(`[PAYMENT DEBUG - index] api.receivePayment completed in ${(performance.now() - stepStart).toFixed(2)}ms`);

      if (markAllPastSettled) {
        console.log(`[PAYMENT DEBUG - index] Calling api.markPastOrdersSettled...`);
        stepStart = performance.now();
        await api.markPastOrdersSettled(payAmountOrder.personId, payAmountOrder.date);
        console.log(`[PAYMENT DEBUG - index] api.markPastOrdersSettled completed in ${(performance.now() - stepStart).toFixed(2)}ms`);
      } else if (markSettled) {
        console.log(`[PAYMENT DEBUG - index] Calling api.markOrderSettled...`);
        stepStart = performance.now();
        await api.markOrderSettled(payAmountOrder.id, true);
        console.log(`[PAYMENT DEBUG - index] api.markOrderSettled completed in ${(performance.now() - stepStart).toFixed(2)}ms`);
      }
      setPayAmountOrder(null);
      console.log(`[PAYMENT DEBUG - index] Total payment flow completed in ${(performance.now() - startTime).toFixed(2)}ms`);
      console.log('==================================================\n');
    } catch (e) {
      console.error('[PAYMENT DEBUG ERROR - index]', e);
      Alert.alert(t('common.error'), 'Failed to process payment.');
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
          po.items.forEach((i: any) => {
            const cost = i.unitPrice !== null ? `$${(i.unitPrice * i.quantity).toFixed(2)}` : 'TBD';
            text += `    • ${i.quantity}x ${i.itemDef?.name} - ${cost}\n`;
          });
          text += `    Total: ${po.totalCost === 0 && po.hasUnknownPriceItems ? 'TBD' : `$${po.totalCost.toFixed(2)}${po.hasUnknownPriceItems ? ' + TBD' : ''}`}\n`;

          let balText = '';
          if (po.person.balance > 0) balText = `You are owed: $${Math.abs(po.person.balance).toFixed(2)}`;
          else if (po.person.balance < 0) balText = `You owe them: $${Math.abs(po.person.balance).toFixed(2)}`;
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

  const handleDeleteOrder = React.useCallback((orderId: string, personName: string, isSettled: boolean) => {
    if (isSettled) {
      Alert.alert(
        t('run.deleteOrderTitle'),
        t('run.deleteSettledOrderConfirm', { name: personName }),
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
  }, [t]);

  const handleEditOrder = React.useCallback((order: any, person: any) => {
    router.push({
      pathname: '/add-order',
      params: {
        personId: person.id,
        date: order.targetDate,
        edit: Date.now().toString()
      }
    });
  }, [router]);

  const getSourceTotal = (itemsList: { totalCost: number }[]) => {
    return itemsList.reduce((sum, ag) => sum + ag.totalCost, 0);
  };

  const toggleSourceCollapse = React.useCallback((sourceKey: string) => {
    perfLog(`[PERF] [Interaction] toggleSourceCollapse called for: ${sourceKey}`);
    const start = performance.now();
    setCollapsedSources(prev => ({ ...prev, [sourceKey]: !prev[sourceKey] }));
    perfLog(`[PERF] [Interaction] toggleSourceCollapse state update triggered in ${(performance.now() - start).toFixed(2)}ms`);
  }, []);

  const toggleLocationCollapse = React.useCallback((locKey: string) => {
    perfLog(`[PERF] [Interaction] toggleLocationCollapse called for: ${locKey}`);
    const start = performance.now();
    setCollapsedLocations(prev => ({ ...prev, [locKey]: !prev[locKey] }));
    perfLog(`[PERF] [Interaction] toggleLocationCollapse state update triggered in ${(performance.now() - start).toFixed(2)}ms`);
  }, []);

  const toggleOrderSelection = React.useCallback((orderId: string) => {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
        if (next.size === 0) setSelectionMode(false);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const handleOrderLongPress = React.useCallback((orderId: string) => {
    setSelectionMode((prevMode) => {
      if (!prevMode) {
        setSelectedOrders(new Set([orderId]));
        return true;
      }
      return prevMode;
    });
  }, []);

  const handleOrderPress = React.useCallback((orderId: string) => {
    if (selectionMode) {
      toggleOrderSelection(orderId);
    }
  }, [selectionMode, toggleOrderSelection]);

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

      <View style={{ flex: 1, position: 'relative' }}>
        {(activeLocation || activePerson) && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, backgroundColor: '#1a1a1a', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 3, elevation: 5 }}>
            {activeLocation && (
              <View
                onLayout={e => { locationHeaderHeight.current = e.nativeEvent.layout.height; }}
                style={{ paddingHorizontal: settings.compactMode ? 8 : 15, paddingTop: 0, paddingBottom: 10 }}>
                <TouchableOpacity
                  style={[styles.locationHeaderRow, settings.compactMode && styles.locationHeaderRowCompact, { marginBottom: 0, borderBottomWidth: 0 }]}
                  onPress={() => toggleLocationCollapse(activeLocation)}
                  activeOpacity={0.7}>
                  <FontAwesome
                    name={collapsedLocations[activeLocation] ? 'caret-right' : 'caret-down'}
                    size={settings.compactMode ? 16 : 20}
                    color={LIGHT_GOLD}
                    style={{ width: 24, textAlign: 'center' }}
                  />
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.deliveryLocationTitle, settings.compactMode && styles.deliveryLocationTitleCompact, { flex: 1 }]}>
                    📍 {activeLocation}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {activePerson && (
              <View style={{ paddingHorizontal: settings.compactMode ? 8 : 15, paddingBottom: 10 }}>
                <View style={[styles.personHeaderRow, settings.compactMode && styles.personHeaderRowCompact, { marginBottom: 0, borderBottomWidth: 0, paddingBottom: 0 }]}>
                  <FontAwesome name="user" size={settings.compactMode ? 14 : 16} color={ACCENT_GOLD} style={{ width: 24, textAlign: 'center' }} />
                  <Text style={[styles.personHeaderText, settings.compactMode && styles.personHeaderTextCompact, { flex: 1 }]}>
                    {activePerson.name}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        <FlatList
          data={flatListData}
          renderItem={renderFlatItem}
          keyExtractor={(item) => item.id}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          style={styles.container}
          contentContainerStyle={[styles.content, settings.compactMode && styles.contentCompact, { paddingBottom: 100 }]}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={false}
        />
      </View>

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
        <SettleUpModal
          visible={!!payAmountOrder}
          personId={payAmountOrder.personId}
          personName={payAmountOrder.personName}
          currentBalance={payAmountOrder.currentBalance}
          orderId={payAmountOrder.id}
          onClose={() => setPayAmountOrder(null)}
          onSubmit={handleCustomPayment}
        />
      )}
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
  searchInputCompact: {
    paddingVertical: 6,
    fontSize: 14,
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
  quantityBadge: { backgroundColor: '#3d3522', paddingHorizontal: 6, paddingVertical: 0, borderRadius: 4, height: 16, justifyContent: 'center', alignItems: 'center' },
  quantityText: { color: '#eee', fontWeight: '500', fontSize: 11, lineHeight: 12 },
  quantityTextMultiple: { fontWeight: '900' },
  quantityBadgeCompact: { backgroundColor: '#3d3522', paddingHorizontal: 5, paddingVertical: 0, borderRadius: 4, height: 16, justifyContent: 'center', alignItems: 'center' },
  quantityTextCompact: { fontSize: 12, lineHeight: 11 },
  quantityBadgeCrossed: { opacity: 0.7 },
  quantityTextCrossed: { color: '#666', textDecorationLine: 'line-through' },
  priceBadge: { paddingHorizontal: 6, paddingVertical: 0, borderRadius: 6 },
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
  statusUnsettled: { color: '#ffa726' },
  statusSettled: { color: '#5c8a6a' },
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
    borderRadius: 6,
  },
  paymentBtnOuter: {
    borderRadius: 6,
    padding: 1,
  },
  paymentBtnInner: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  markAllPaidText: { color: '#1a1a1a', fontWeight: 'bold', fontSize: 12 },
  markAllPaidBtn: {},
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

interface MemoizedTaskProps {
  task: any;
  isCompleted: boolean;
  compactMode: boolean;
  onToggle: (taskId: string, currentStatus: boolean, taskTargetDate?: string | null) => void;
  onLongPress: (task: any) => void;
}

const MemoizedTaskPill = React.memo(function MemoizedTaskPill({
  task,
  isCompleted,
  compactMode,
  onToggle,
  onLongPress
}: MemoizedTaskProps) {
  return (
    <TouchableOpacity
      style={[styles.taskPill, isCompleted && styles.taskPillCompleted, compactMode && styles.taskPillCompact]}
      onPress={() => onToggle(task.id, isCompleted, task.targetDate)}
      onLongPress={() => onLongPress(task)}
    >
      <FontAwesome name={isCompleted ? "check-circle" : "circle-thin"} size={compactMode ? 14 : 16} color={isCompleted ? ACCENT_GOLD : "#ccc"} />
      <Text style={[styles.taskPillText, isCompleted && styles.taskPillTextCompleted, compactMode && styles.textExtraSmall]}>{task.title}</Text>
      {task.targetTime && <Text style={[styles.taskPillTime, compactMode && styles.textExtraSmall]}>{task.targetTime}</Text>}
    </TouchableOpacity>
  );
}, (prev, next) => {
  return prev.task.id === next.task.id &&
    prev.task.title === next.task.title &&
    prev.isCompleted === next.isCompleted &&
    prev.compactMode === next.compactMode;
});

const MemoizedPhysicalTaskRow = React.memo(function MemoizedPhysicalTaskRow({
  task,
  isCompleted,
  compactMode,
  onToggle,
  onLongPress
}: MemoizedTaskProps) {
  return (
    <TouchableOpacity
      style={[styles.checklistRow, compactMode && styles.checklistRowCompact]}
      onPress={() => onToggle(task.id, isCompleted, task.targetDate)}
      onLongPress={() => onLongPress(task)}
    >
      <FontAwesome name={isCompleted ? "check-square-o" : "square-o"} size={compactMode ? 18 : 22} color={isCompleted ? ACCENT_GOLD : ACCENT_GOLD} />
      <Text style={[styles.checklistText, isCompleted && styles.checklistTextCompleted, compactMode && styles.textSmall]}>
        {task.title}
      </Text>
    </TouchableOpacity>
  );
}, (prev, next) => {
  return prev.task.id === next.task.id &&
    prev.task.title === next.task.title &&
    prev.isCompleted === next.isCompleted &&
    prev.compactMode === next.compactMode;
});

interface MemoizedPersonTaskProps extends MemoizedTaskProps {
  onEdit: (task: any) => void;
  onDelete: (taskId: string, title: string) => void;
  searchQuery?: string;
}

const MemoizedPersonTaskRow = React.memo(function MemoizedPersonTaskRow({
  task,
  isCompleted,
  compactMode,
  onToggle,
  onLongPress,
  onEdit,
  onDelete,
  searchQuery
}: MemoizedPersonTaskProps) {
  return (
    <View style={[styles.personTaskRow, compactMode && styles.personTaskRowCompact]}>
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}
        onPress={() => onToggle(task.id, isCompleted, task.targetDate)}
        onLongPress={() => onLongPress(task)}
      >
        <FontAwesome name={isCompleted ? "check-square-o" : "square-o"} size={compactMode ? 16 : 18} color={isCompleted ? ACCENT_GOLD : "#888"} />
        <HighlightText
          text={task.title}
          highlight={searchQuery}
          style={[styles.personTaskText, isCompleted && styles.personTaskTextCompleted, compactMode && styles.textSmall]}
        />
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', gap: 12, marginStart: 10 }}>
        <TouchableOpacity onPress={() => onEdit(task)}>
          <FontAwesome name="edit" size={compactMode ? 16 : 18} color={ACCENT_GOLD} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onDelete(task.id, task.title)}>
          <FontAwesome name="trash" size={compactMode ? 16 : 18} color="#ff4444" />
        </TouchableOpacity>
      </View>
    </View>
  );
}, (prev, next) => {
  return prev.task.id === next.task.id &&
    prev.task.title === next.task.title &&
    prev.isCompleted === next.isCompleted &&
    prev.compactMode === next.compactMode &&
    prev.searchQuery === next.searchQuery;
});

interface OrderItemRowProps {
  item: any;
  compactMode: boolean;
  isRTL: boolean;
  t: (key: string, params?: any) => string;
  searchQuery?: string;
}

const OrderItemRow = React.memo(function OrderItemRow({
  item,
  compactMode,
  isRTL,
  t,
  searchQuery
}: OrderItemRowProps) {
  const itemCost = (item.unitPrice ?? 0) * item.quantity;
  return (
    <View style={[styles.itemRow2, compactMode && styles.itemRow2Compact]}>
      <View style={[styles.itemInfo, { alignItems: 'center', flexDirection: 'row', gap: 8, flexShrink: 1, overflow: 'hidden' }]}>
        <View style={[
          styles.quantityBadge,
          compactMode && styles.quantityBadgeCompact,
        ]}>
          <Text style={[
            styles.quantityText,
            compactMode && styles.quantityTextCompact,
            item.quantity > 1 && styles.quantityTextMultiple
          ]}>
            x{item.quantity}
          </Text>
        </View>
        <HighlightText
          text={(isRTL ? '\u200F' : '') + (item.itemDef?.name || '')}
          highlight={searchQuery}
          style={[styles.itemText, { flexShrink: 1, marginStart: 0 }, compactMode && styles.textExtraSmall]}
          numberOfLines={1}
          ellipsizeMode="tail"
        />
      </View>
      <View style={styles.itemPriceContainer}>
        {item.unitPrice === null ? (
          <Text style={[styles.itemPrice, { color: '#ffeb3b', fontStyle: 'italic' }, compactMode && styles.textExtraSmall]}>{t('common.priceTBD')}</Text>
        ) : itemCost > 0 ? (
          <Text style={[styles.itemPrice, compactMode && styles.textExtraSmall]}>${itemCost.toFixed(2)}</Text>
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
  onDelete: (orderId: string, personName: string, isSettled: boolean) => void;
  onPayAmount: (payInfo: { id: string; personId: string; total: number; personName: string; targetDate: string; currentBalance: number }) => void;
  onMarkPaid: (orderId: string, personId: string) => void;
  onMarkUnpaid: (orderId: string, personId: string) => void;
  onUnknownPrice: (personInfo: { id: string; name: string }) => void;
  onHistory: (personInfo: { id: string; name: string }) => void;
  onOrdersClick: (personInfo: { id: string; name: string }) => void;
  searchQuery?: string;
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
  onOrdersClick,
  searchQuery,
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
                    {po.totalCost === 0 && po.hasUnknownPriceItems ? t('common.priceTBD') : `$${po.totalCost.toFixed(2)}${po.hasUnknownPriceItems ? ` + ${t('common.priceTBD')}` : ''}`}
                  </Text>
                  <View style={[styles.statusContainer, compactMode && { height: 16 }]}>
                    <Text style={[styles.statusText, po.unpaidCost > 0 ? styles.statusUnsettled : styles.statusSettled, compactMode && styles.textExtraSmall, { textAlign: isRTL ? 'right' : 'left' }]}>
                      {po.hasUnknownPriceItems ? t('run.statusAwaitingPrices') : po.unpaidCost > 0 ? t('run.statusUnsettled') : t('run.statusSettled')}
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
                      <TouchableOpacity onPress={() => onDelete(po.order.id, po.person.name, po.order.isSettled)} style={styles.deleteOrderBtn}>
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
                searchQuery={searchQuery}
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => onOrdersClick({ id: po.person.id, name: po.person.name })}
                  style={[styles.historyBtn, compactMode && styles.paddingSmall]}
                >
                  <FontAwesome name="list-alt" size={compactMode ? 14 : 16} color={ACCENT_GOLD} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onHistory({ id: po.person.id, name: po.person.name })}
                  style={[styles.historyBtn, compactMode && styles.paddingSmall]}
                >
                  <FontAwesome name="history" size={compactMode ? 14 : 16} color={ACCENT_GOLD} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.buttonGroup}>
            <TouchableOpacity onPress={() => po.order.isSettled ? onMarkUnpaid(po.order.id, po.person.id) : onMarkPaid(po.order.id, po.person.id)} style={styles.paymentShadow}>
              <LinearGradient colors={SILVER_BEVEL} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.paymentBtnOuter}>
                <LinearGradient colors={LIQUID_SILVER_STOPS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.paymentBtnInner}>
                  <Text style={[styles.markAllPaidText, compactMode && { fontSize: 10 }]}>{po.order.isSettled ? t('run.markUnsettled') : t('run.markSettled')}</Text>
                </LinearGradient>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}, (prev, next) => {
  return prev.po.order.id === next.po.order.id &&
    prev.po.person.balance === next.po.person.balance &&
    prev.po.unpaidCost === next.po.unpaidCost &&
    prev.po.totalCost === next.po.totalCost &&
    prev.po.hasUnknownPriceItems === next.po.hasUnknownPriceItems &&
    prev.po.items.length === next.po.items.length &&
    prev.selectionMode === next.selectionMode &&
    prev.isSelected === next.isSelected &&
    prev.compactMode === next.compactMode &&
    prev.isRTL === next.isRTL &&
    prev.searchQuery === next.searchQuery;
});

interface ShoppingListItemRowProps {
  ag: any;
  isChecked: boolean;
  compactMode: boolean;
  isRTL: boolean;
  onToggleCheck: (itemId: string) => void;
}

const ShoppingListItemRow = React.memo(function ShoppingListItemRow({
  ag,
  isChecked,
  compactMode,
  isRTL,
  onToggleCheck,
}: ShoppingListItemRowProps) {
  return (
    <TouchableOpacity
      style={[styles.itemRow, compactMode && styles.itemRowCompact]}
      onPress={() => onToggleCheck(ag.item.id)}>
      <FontAwesome
        name={isChecked ? 'check-square' : 'square-o'}
        size={compactMode ? 20 : 24}
        color={ACCENT_GOLD}
      />
      <View style={{ flex: 1, alignItems: 'center', flexDirection: 'row', gap: 8, overflow: 'hidden', marginStart: 10 }}>
        <View style={[
          styles.quantityBadge,
          compactMode && styles.quantityBadgeCompact,
          isChecked && styles.quantityBadgeCrossed
        ]}>
          <Text style={[
            styles.quantityText,
            compactMode && styles.quantityTextCompact,
            isChecked && styles.quantityTextCrossed,
            ag.totalQuantity > 1 && styles.quantityTextMultiple
          ]}>
            x{ag.totalQuantity}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[
            styles.itemText,
            compactMode && styles.itemTextCompact,
            isChecked && styles.itemTextCrossed,
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
            isChecked && styles.itemTextCrossed,
          ]}>
            ${ag.totalCost.toFixed(2)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}, (prev, next) => {
  return prev.ag === next.ag &&
    prev.isChecked === next.isChecked &&
    prev.compactMode === next.compactMode &&
    prev.isRTL === next.isRTL;
});

interface SourceGroupCardProps {
  source: string;
  sourceKey: string;
  itemsList: any[];
  sourceTotal: number;
  isCollapsed: boolean;
  checkedItems: Record<string, boolean>;
  compactMode: boolean;
  isRTL: boolean;
  onToggleCollapse: (sourceKey: string) => void;
  onToggleCheck: (itemId: string) => void;
}

const SourceGroupCard = React.memo(function SourceGroupCard({
  source,
  sourceKey,
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
          onPress={() => onToggleCollapse(sourceKey)}
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
          <ShoppingListItemRow
            key={ag.item.id}
            ag={ag}
            isChecked={checkedItems[ag.item.id] || false}
            compactMode={compactMode}
            isRTL={isRTL}
            onToggleCheck={onToggleCheck}
          />
        ))}
      </View>
    </View>
  );
}, (prev, next) => {
  return prev.sourceKey === next.sourceKey &&
    prev.itemsList === next.itemsList &&
    prev.sourceTotal === next.sourceTotal &&
    prev.isCollapsed === next.isCollapsed &&
    prev.checkedItems === next.checkedItems &&
    prev.compactMode === next.compactMode &&
    prev.isRTL === next.isRTL;
});
