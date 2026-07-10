import React, { useMemo, useState } from 'react';
import { StyleSheet, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Keyboard, I18nManager, FlatList, Pressable, Animated } from 'react-native';
import { useSettings } from '@/utils/settings';
import { Text, View, TextInput } from '@/components/Themed';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { db } from '@/db';
import { persons, items, orderItems, orders, itemAliases, placeAliases, sourceAliases } from '@/db/schema';
import { api } from '@/db/api';
import CreateItemModal from '@/components/CreateItemModal';
import EditStringEntityModal from '@/components/EditStringEntityModal';
import MergeModal from '@/components/MergeModal';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTranslation } from '@/utils/i18n';
import { ACCENT_GOLD } from '@/constants/Colors';
import { formatDateTime } from '@/utils/dates';

const EMPTY_ARRAY: any[] = [];

export default function StatsScreen() {
  const { data: peopleList } = useLiveQuery(db.select().from(persons));
  const { data: catalog } = useLiveQuery(db.select().from(items));
  const { data: allOrders } = useLiveQuery(db.select().from(orders));
  const { data: allOrderItems } = useLiveQuery(db.select().from(orderItems));
  
  const { data: itemAliasesList } = useLiveQuery(db.select().from(itemAliases));
  const { data: placeAliasesList } = useLiveQuery(db.select().from(placeAliases));
  const { data: sourceAliasesList } = useLiveQuery(db.select().from(sourceAliases));

  const { settings } = useSettings();
  const { t, isRTL } = useTranslation();

  const [activeTab, setActiveTab] = useState<'Items' | 'Places' | 'Sources'>('Items');
  const [searchQuery, setSearchQuery] = useState('');

  // Item Edit State
  const [editingItem, setEditingItem] = useState<any | null>(null);
  
  // String Entity Edit State
  const [editingStringEntity, setEditingStringEntity] = useState<{ type: 'Place' | 'Source', name: string } | null>(null);

  // Selection & Merge State
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mergeModalVisible, setMergeModalVisible] = useState(false);

  // Sorting State
  const [itemSort, setItemSort] = useState<'none' | 'lexical' | 'price' | 'date'>('none');
  const [placeSort, setPlaceSort] = useState<'none' | 'lexical' | 'date'>('none');
  const [sourceSort, setSourceSort] = useState<'none' | 'lexical' | 'date'>('none');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Derive Places and Sources
  const places = useMemo(() => {
    const set = new Set([
      ...(peopleList || []).map(p => p.typicalPlace), 
      ...(allOrders || []).map(o => o.deliveryPlace)
    ]);
    return Array.from(set).filter(Boolean) as string[];
  }, [peopleList, allOrders]);

  const sources = useMemo(() => {
    const set = new Set((catalog || []).map(c => c.source));
    return Array.from(set).filter(Boolean) as string[];
  }, [catalog]);

  const editingItemAliases = useMemo(() => {
    if (!editingItem || !itemAliasesList) return EMPTY_ARRAY;
    return itemAliasesList.filter(a => a.itemId === editingItem.id).map(a => a.alias);
  }, [editingItem?.id, itemAliasesList]);

  const editingStringEntityAliases = useMemo(() => {
    if (!editingStringEntity) return EMPTY_ARRAY;
    if (editingStringEntity.type === 'Place') {
      return placeAliasesList?.filter(a => a.placeName === editingStringEntity.name).map(a => a.alias) || EMPTY_ARRAY;
    } else {
      return sourceAliasesList?.filter(a => a.sourceName === editingStringEntity.name).map(a => a.alias) || EMPTY_ARRAY;
    }
  }, [editingStringEntity, placeAliasesList, sourceAliasesList]);

  // Stats derivation
  const stats = useMemo(() => {
    if (!peopleList || !catalog || !allOrders || !allOrderItems) return null;

    const personTotals: Record<string, { name: string; total: number }> = {};
    const itemPopularity: Record<string, { name: string; qty: number }> = {};
    let totalSpent = 0;

    peopleList.forEach((p) => { personTotals[p.id] = { name: p.name, total: 0 }; });
    catalog.forEach((c) => { itemPopularity[c.id] = { name: c.name, qty: 0 }; });

    allOrderItems.forEach((oi) => {
      const order = allOrders.find((o) => o.id === oi.orderId);
      if (order && personTotals[order.personId]) {
        const cost = (oi.unitPrice ?? 0) * oi.quantity;
        personTotals[order.personId].total += cost;
        totalSpent += cost;
      }
      if (itemPopularity[oi.itemId]) {
        itemPopularity[oi.itemId].qty += oi.quantity;
      }
    });

    const topItems = Object.values(itemPopularity).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const topSpenders = Object.values(personTotals).sort((a, b) => b.total - a.total).slice(0, 5);

    return { totalSpent, topItems, topSpenders, totalOrders: allOrders.length };
  }, [peopleList, catalog, allOrders, allOrderItems]);

  // --- ACTIONS ---

  const handleSaveItem = async (name: string, defaultPrice: number | null, source: string | null, timing: 'Fresh' | 'Anytime', isCorrection: boolean, aliases: string[]) => {
    if (!editingItem) return;
    await api.updateItem(editingItem.id, { name, defaultPrice, source, timing, aliases }, isCorrection);
    setEditingItem(null);
  };

  const handleSaveStringEntity = async (oldName: string, newName: string, aliases: string[]) => {
    if (!editingStringEntity) return;
    if (editingStringEntity.type === 'Place') {
      await api.updatePlace(oldName, newName, aliases);
    } else {
      await api.updateSource(oldName, newName, aliases);
    }
    setEditingStringEntity(null);
  };

  const handleBulkDelete = () => {
    Alert.alert(
      t('stats.deleteConfirmTitle'),
      t('stats.deleteConfirmBody', { count: selectedIds.size, tab: activeTab.toLowerCase() }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              for (const id of Array.from(selectedIds)) {
                if (activeTab === 'Items') await api.deleteItem(id);
                else if (activeTab === 'Places') await api.deletePlace(id);
                else if (activeTab === 'Sources') await api.deleteSource(id);
              }
              setSelectionMode(false);
              setSelectedIds(new Set());
            } catch (e) {
              console.error(e);
              Alert.alert(t('common.error'), t('stats.deleteError'));
            }
          },
        },
      ]
    );
  };

  const getMergeEntities = () => {
    if (selectedIds.size !== 2) return { entityA: null, entityB: null };
    const ids = Array.from(selectedIds);
    
    if (activeTab === 'Items') {
      const i1 = catalog?.find(c => c.id === ids[0]);
      const i2 = catalog?.find(c => c.id === ids[1]);
      if (!i1 || !i2) return { entityA: null, entityB: null };
      return {
        entityA: { id: i1.id, name: i1.name, details: `${t('stats.detailsSource')} ${i1.source || t('stats.na')}` },
        entityB: { id: i2.id, name: i2.name, details: `${t('stats.detailsSource')} ${i2.source || t('stats.na')}` }
      };
    } else {
      return {
        entityA: { id: ids[0], name: ids[0] },
        entityB: { id: ids[1], name: ids[1] }
      };
    }
  };

  const handleConfirmMerge = async (primaryId: string, secondaryId: string, keepAsAlias: boolean) => {
    if (activeTab === 'Items') await api.mergeItems(primaryId, secondaryId, keepAsAlias);
    else if (activeTab === 'Places') await api.mergePlaces(primaryId, secondaryId, keepAsAlias);
    else if (activeTab === 'Sources') await api.mergeSources(primaryId, secondaryId, keepAsAlias);
    
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSort = (type: any) => {
    const current = activeTab === 'Items' ? itemSort : activeTab === 'Places' ? placeSort : sourceSort;
    const setter = activeTab === 'Items' ? setItemSort : activeTab === 'Places' ? setPlaceSort : setSourceSort;
    
    if (current === type) {
      if (sortOrder === 'asc') setSortOrder('desc');
      else setter('none');
    } else {
      setter(type);
      setSortOrder('asc');
    }
  };

  // --- CALLBACKS & DATA DERIVATIONS ---

  const toggleSelection = React.useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const handleLongPress = React.useCallback((id: string) => {
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedIds(new Set([id]));
    }
  }, [selectionMode]);

  const handleEditClick = React.useCallback((item: any) => {
    setEditingItem(item);
  }, []);

  // --- FILTERING & SORTING ---

  const sortedItems = useMemo(() => {
    if (!catalog) return [];
    let list = [...catalog];
    if (itemSort === 'lexical') {
      list.sort((a, b) => sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
    } else if (itemSort === 'price') {
      list.sort((a, b) => sortOrder === 'asc' ? (a.defaultPrice || 0) - (b.defaultPrice || 0) : (b.defaultPrice || 0) - (a.defaultPrice || 0));
    } else if (itemSort === 'date') {
      list.sort((a, b) => {
        // @ts-ignore
        const da = a.createdAt || '';
        // @ts-ignore
        const db = b.createdAt || '';
        return sortOrder === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
      });
    }
    return list;
  }, [catalog, itemSort, sortOrder]);

  const filteredItems = sortedItems.filter(item => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const aliases = itemAliasesList?.filter(a => a.itemId === item.id).map(a => a.alias) || [];
    const searchString = [item.name, item.defaultPrice?.toString(), item.source, item.timing, ...aliases].join(' ').toLowerCase();
    return searchString.includes(q);
  });

  const getEntityDate = (name: string, type: 'Place' | 'Source') => {
    const aliases = type === 'Place' ? placeAliasesList : sourceAliasesList;
    const match = aliases?.find(a => (type === 'Place' ? (a as any).placeName : (a as any).sourceName) === name);
    // @ts-ignore
    return match?.createdAt || '';
  };

  const sortedPlaces = useMemo(() => {
    let list = [...places];
    if (placeSort === 'lexical') {
      list.sort((a, b) => sortOrder === 'asc' ? a.localeCompare(b) : b.localeCompare(a));
    } else if (placeSort === 'date') {
      list.sort((a, b) => {
        const da = getEntityDate(a, 'Place');
        const db = getEntityDate(b, 'Place');
        return sortOrder === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
      });
    }
    return list;
  }, [places, placeSort, sortOrder, placeAliasesList]);

  const filteredPlaces = sortedPlaces.filter(place => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const aliases = placeAliasesList?.filter(a => a.placeName === place).map(a => a.alias) || [];
    return [place, ...aliases].join(' ').toLowerCase().includes(q);
  });

  const sortedSources = useMemo(() => {
    let list = [...sources];
    if (sourceSort === 'lexical') {
      list.sort((a, b) => sortOrder === 'asc' ? a.localeCompare(b) : b.localeCompare(a));
    } else if (sourceSort === 'date') {
      list.sort((a, b) => {
        const da = getEntityDate(a, 'Source');
        const db = getEntityDate(b, 'Source');
        return sortOrder === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
      });
    }
    return list;
  }, [sources, sourceSort, sortOrder, sourceAliasesList]);

  const filteredSources = sortedSources.filter(source => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const aliases = sourceAliasesList?.filter(a => a.sourceName === source).map(a => a.alias) || [];
    return [source, ...aliases].join(' ').toLowerCase().includes(q);
  });

  const listData = useMemo(() => {
    if (activeTab === 'Items') return filteredItems;
    if (activeTab === 'Places') return filteredPlaces;
    return filteredSources;
  }, [activeTab, filteredItems, filteredPlaces, filteredSources]);

  const renderDictionaryItem = React.useCallback(({ item }: { item: any }) => {
    if (activeTab === 'Items') {
      const isSelected = selectedIds.has(item.id);
      const aliases = itemAliasesList?.filter(a => a.itemId === item.id).map(a => a.alias) || [];
      return (
        <ItemCard
          item={item}
          isSelected={isSelected}
          aliases={aliases}
          compactMode={settings.compactMode}
          selectionMode={selectionMode}
          onLongPress={handleLongPress}
          onPress={(id) => selectionMode ? toggleSelection(id) : null}
          onEdit={handleEditClick}
          t={t}
          language={settings.language || 'en'}
        />
      );
    } else {
      const isSelected = selectedIds.has(item);
      const aliases = activeTab === 'Places'
        ? placeAliasesList?.filter(a => a.placeName === item).map(a => a.alias) || []
        : sourceAliasesList?.filter(a => a.sourceName === item).map(a => a.alias) || [];
      return (
        <StringEntityCard
          name={item}
          type={activeTab === 'Places' ? 'Place' : 'Source'}
          isSelected={isSelected}
          aliases={aliases}
          compactMode={settings.compactMode}
          selectionMode={selectionMode}
          onLongPress={handleLongPress}
          onPress={(name) => selectionMode ? toggleSelection(name) : null}
          onEdit={setEditingStringEntity}
          t={t}
        />
      );
    }
  }, [
    activeTab,
    selectedIds,
    settings.compactMode,
    selectionMode,
    itemAliasesList,
    placeAliasesList,
    sourceAliasesList,
    t,
    handleLongPress,
    toggleSelection,
    handleEditClick,
    setEditingStringEntity
  ]);

  const renderHeader = React.useCallback(() => {
    return (
      <View>
        {/* STATISTICS SECTION */}
        {stats && (
          <View>
            <Text style={[styles.sectionTitle, settings.compactMode && styles.sectionTitleCompact]}>{t('stats.appStatsTitle')}</Text>
            <View style={[styles.statsCard, settings.compactMode && styles.statsCardCompact]}>
              <Text style={[styles.statText, settings.compactMode && styles.textSmall]}>{t('stats.totalHandled')} <Text style={[styles.highlight, settings.compactMode && styles.highlightCompact]}>${stats.totalSpent.toFixed(2)}</Text></Text>
              <Text style={[styles.statText, settings.compactMode && styles.textSmall]}>{t('stats.totalOrders')} <Text style={[styles.highlight, settings.compactMode && styles.highlightCompact]}>{stats.totalOrders}</Text></Text>
              
              <Text style={[styles.subTitle, settings.compactMode && styles.subTitleCompact]}>{t('stats.topSpenders')}</Text>
              {stats.topSpenders.map((p, idx) => (
                <Text key={idx} style={[styles.listItem, settings.compactMode && styles.textSmall]}>
                  {isRTL ? '\u2066' : ''}{idx + 1}. {p.name} - ${p.total.toFixed(2)}{isRTL ? '\u2069' : ''}
                </Text>
              ))}

              <Text style={[styles.subTitle, settings.compactMode && styles.subTitleCompact]}>{t('stats.topItems')}</Text>
              {stats.topItems.map((i, idx) => (
                <Text key={idx} style={[styles.listItem, settings.compactMode && styles.textSmall]}>
                  {isRTL ? '\u2066' : ''}{idx + 1}. {i.name} ({i.qty} {t('stats.ordered')}){isRTL ? '\u2069' : ''}
                </Text>
              ))}
            </View>
            <View style={styles.separator} />
          </View>
        )}

        {/* DICTIONARY SECTION */}
        {!selectionMode ? (
          <View style={styles.dictionaryHeader}>
            <Text style={[styles.sectionTitle, settings.compactMode && styles.sectionTitleCompact]}>{t('stats.dictionaryTitle')}</Text>
            <View style={styles.tabRow}>
              {(['Items', 'Places', 'Sources'] as const).map(tab => {
                const tabLabel = tab === 'Items' ? t('stats.tabItems') : tab === 'Places' ? t('stats.tabPlaces') : t('stats.tabSources');
                return (
                  <TouchableOpacity 
                    key={tab} 
                    style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]} 
                    onPress={() => setActiveTab(tab)}
                  >
                    <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive, settings.compactMode && styles.textSmall]}>{tabLabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : (
          <View style={[styles.selectionHeader, settings.compactMode && styles.selectionHeaderCompact]}>
            <View style={styles.selectionLeft}>
              <TouchableOpacity onPress={() => { setSelectionMode(false); setSelectedIds(new Set()); }}>
                <FontAwesome name="times" size={settings.compactMode ? 20 : 24} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.selectionTitle}>{selectedIds.size} {t('run.selected')}</Text>
            </View>
            <View style={styles.headerActions}>
              {selectedIds.size === 2 && (
                <TouchableOpacity style={[styles.mergeBtn, settings.compactMode && styles.compactBtn]} onPress={() => setMergeModalVisible(true)}>
                  <FontAwesome name="compress" size={settings.compactMode ? 14 : 16} color="#fff" />
                  <Text style={[styles.addBtnText, settings.compactMode && styles.textExtraSmall]}>{t('common.edit')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.bulkDeleteBtn, settings.compactMode && styles.compactBtn]} onPress={handleBulkDelete}>
                <FontAwesome name="trash" size={settings.compactMode ? 14 : 16} color="#fff" />
                <Text style={[styles.addBtnText, settings.compactMode && styles.textExtraSmall]}>{t('common.delete')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.dictionarySearchRow}>
          <TextInput
            style={[styles.dictionarySearch, settings.compactMode && styles.dictionarySearchCompact]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('stats.searchDict', { tab: activeTab === 'Items' ? t('stats.tabItems') : activeTab === 'Places' ? t('stats.tabPlaces') : t('stats.tabSources') })}
            placeholderTextColor="#888"
          />
        </View>

        {!selectionMode && (
          <View style={[styles.sortBar, settings.compactMode && styles.sortBarCompact]}>
            <Text style={[styles.sortLabel, settings.compactMode && styles.textExtraSmall]}>{t('stats.sortLabel')}</Text>
            
            <FadePressable 
              style={[styles.sortBtn, (activeTab === 'Items' ? itemSort : activeTab === 'Places' ? placeSort : sourceSort) === 'lexical' && styles.sortBtnActive, settings.compactMode && styles.sortBtnCompact]} 
              onPress={() => toggleSort('lexical')}
            >
              <FontAwesome name="sort-alpha-asc" size={settings.compactMode ? 12 : 14} color={(activeTab === 'Items' ? itemSort : activeTab === 'Places' ? placeSort : sourceSort) === 'lexical' ? "#fff" : "#888"} />
              <Text style={[styles.sortBtnText, (activeTab === 'Items' ? itemSort : activeTab === 'Places' ? placeSort : sourceSort) === 'lexical' && styles.sortBtnTextActive, settings.compactMode && styles.textExtraSmall]}>{t('stats.sortAZ')}</Text>
              {(activeTab === 'Items' ? itemSort : activeTab === 'Places' ? placeSort : sourceSort) === 'lexical' && (
                <FontAwesome name={sortOrder === 'asc' ? "caret-up" : "caret-down"} size={10} color="#fff" style={{ marginStart: 2 }} />
              )}
            </FadePressable>

            {activeTab === 'Items' && (
              <FadePressable 
                style={[styles.sortBtn, itemSort === 'price' && styles.sortBtnActive, settings.compactMode && styles.sortBtnCompact]} 
                onPress={() => toggleSort('price')}
              >
                <FontAwesome name="dollar" size={settings.compactMode ? 12 : 14} color={itemSort === 'price' ? "#fff" : "#888"} />
                <Text style={[styles.sortBtnText, itemSort === 'price' && styles.sortBtnTextActive, settings.compactMode && styles.textExtraSmall]}>{t('stats.sortPrice')}</Text>
                {itemSort === 'price' && (
                  <FontAwesome name={sortOrder === 'asc' ? "caret-up" : "caret-down"} size={10} color="#fff" style={{ marginStart: 2 }} />
                )}
              </FadePressable>
            )}

            <FadePressable 
              style={[styles.sortBtn, (activeTab === 'Items' ? itemSort : activeTab === 'Places' ? placeSort : sourceSort) === 'date' && styles.sortBtnActive, settings.compactMode && styles.sortBtnCompact]} 
              onPress={() => toggleSort('date')}
            >
              <FontAwesome name="clock-o" size={settings.compactMode ? 12 : 14} color={(activeTab === 'Items' ? itemSort : activeTab === 'Places' ? placeSort : sourceSort) === 'date' ? "#fff" : "#888"} />
              <Text style={[styles.sortBtnText, (activeTab === 'Items' ? itemSort : activeTab === 'Places' ? placeSort : sourceSort) === 'date' && styles.sortBtnTextActive, settings.compactMode && styles.textExtraSmall]}>{t('stats.sortAdded')}</Text>
              {(activeTab === 'Items' ? itemSort : activeTab === 'Places' ? placeSort : sourceSort) === 'date' && (
                <FontAwesome name={sortOrder === 'asc' ? "caret-up" : "caret-down"} size={10} color="#fff" style={{ marginStart: 2 }} />
              )}
            </FadePressable>
          </View>
        )}

        {!selectionMode && (
          <Text style={[styles.helperText, settings.compactMode && styles.textExtraSmall]}>
            {t('stats.helperText')}
          </Text>
        )}
      </View>
    );
  }, [
    stats,
    selectionMode,
    selectedIds.size,
    searchQuery,
    activeTab,
    itemSort,
    placeSort,
    sourceSort,
    sortOrder,
    settings.compactMode,
    t,
    isRTL,
    toggleSort,
    handleBulkDelete,
  ]);

  const keyExtractor = React.useCallback((item: any) => {
    return activeTab === 'Items' ? item.id : item;
  }, [activeTab]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}>
      <FlatList 
        data={listData}
        renderItem={renderDictionaryItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={renderHeader()}
        contentContainerStyle={[styles.content, settings.compactMode && styles.contentCompact, { paddingBottom: 100 }]}
        keyboardShouldPersistTaps="handled"
      />

      {editingItem && (
        <CreateItemModal
          visible={!!editingItem}
          title={t('addOrder.editTitle')}
          submitLabel={t('modals.saveChanges')}
          initialName={editingItem.name}
          initialPrice={editingItem.defaultPrice}
          initialSource={editingItem.source}
          initialTiming={editingItem.timing}
          initialAliases={editingItemAliases}
          onCancel={() => setEditingItem(null)}
          onSubmit={handleSaveItem}
        />
      )}

      {editingStringEntity && (
        <EditStringEntityModal
          visible={!!editingStringEntity}
          entityType={editingStringEntity.type}
          initialName={editingStringEntity.name}
          initialAliases={editingStringEntityAliases}
          onClose={() => setEditingStringEntity(null)}
          onSubmit={handleSaveStringEntity}
        />
      )}

      {mergeModalVisible && (
        <MergeModal
          visible={mergeModalVisible}
          entityType={activeTab === 'Items' ? 'Item' : activeTab === 'Places' ? 'Place' : 'Source'}
          entityA={getMergeEntities().entityA}
          entityB={getMergeEntities().entityB}
          onClose={() => setMergeModalVisible(false)}
          onConfirm={handleConfirmMerge}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 15 },
  sectionTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 15, color: '#fff' },
  statsCard: { backgroundColor: '#333', padding: 15, borderRadius: 10, marginBottom: 20 },
  statText: { fontSize: 16, color: '#ccc', marginBottom: 5, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  highlight: { color: '#ffeb3b', fontWeight: 'bold', fontSize: 18, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  subTitle: { fontSize: 18, fontWeight: 'bold', color: ACCENT_GOLD, marginTop: 15, marginBottom: 10 },
  listItem: { color: '#ddd', fontSize: 15, marginStart: 10, marginBottom: 5, textAlign: 'left' },
  separator: { height: 1, backgroundColor: '#555', marginVertical: 20 },
  helperText: { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 15, fontStyle: 'italic' },
  
  dictionaryHeader: { marginBottom: 10 },
  tabRow: { flexDirection: 'row', backgroundColor: '#222', borderRadius: 8, padding: 4, marginBottom: 10 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tabBtnActive: { backgroundColor: '#333' },
  tabText: { color: '#888', fontWeight: 'bold', fontSize: 16 },
  tabTextActive: { color: ACCENT_GOLD },
  
  selectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, backgroundColor: '#333', padding: 15, borderRadius: 10 },
  selectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  selectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  headerActions: { flexDirection: 'row', gap: 10 },
  bulkDeleteBtn: { backgroundColor: '#ff4444', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  mergeBtn: { backgroundColor: '#ff9800', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  dictionarySearch: { backgroundColor: '#333', color: '#fff', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, fontSize: 16, width: '100%', marginBottom: 5 },
  
  itemCard: { backgroundColor: '#222', padding: 15, borderRadius: 10, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardSelected: { borderColor: ACCENT_GOLD, borderWidth: 2, backgroundColor: 'rgba(47, 149, 220, 0.1)' },
  cardContentWrapper: { flex: 1 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 },
  itemName: { fontSize: 18, fontWeight: 'bold', color: '#fff', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  aliasesText: { fontSize: 12, color: '#aaa', marginTop: 2, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  iconBtn: { padding: 5 },
  itemDetails: { gap: 5 },
  detailText: { color: '#ccc', textAlign: 'left' },
  checkboxContainer: { paddingStart: 15 },
  
  // Compact Modifiers
  contentCompact: { padding: 8 },
  sectionTitleCompact: { fontSize: 20, marginBottom: 10 },
  statsCardCompact: { padding: 10, marginBottom: 15 },
  highlightCompact: { fontSize: 16 },
  subTitleCompact: { fontSize: 16, marginTop: 10, marginBottom: 5 },
  dictionarySearchCompact: { paddingVertical: 6, fontSize: 14 },
  itemCardCompact: { padding: 10, marginBottom: 8 },
  itemHeaderCompact: { marginBottom: 3 },
  itemNameCompact: { fontSize: 16 },
  itemDetailsCompact: { gap: 2 },
  textSmall: { fontSize: 13 },
  textExtraSmall: { fontSize: 11 },
  paddingSmall: { padding: 2 },
  selectionHeaderCompact: { padding: 10 },
  compactBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  sortBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 4 },
  sortBarCompact: { gap: 6, marginBottom: 8 },
  sortLabel: { color: '#666', fontSize: 12, fontWeight: 'bold' },
  sortBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#333', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#444', gap: 6 },
  sortBtnCompact: { paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
  sortBtnActive: { backgroundColor: ACCENT_GOLD, borderColor: ACCENT_GOLD },
  sortBtnText: { color: '#888', fontSize: 12, fontWeight: '600' },
  sortBtnTextActive: { color: '#fff' },
  dictionarySearchRow: { marginBottom: 8 },
});

// ==========================================
// MEMOIZED PERFORMANCE-OPTIMIZED SUBCOMPONENTS
// ==========================================

interface FadePressableProps extends React.ComponentProps<typeof Pressable> {
  children: React.ReactNode;
}

const FadePressable = ({ children, style, ...props }: FadePressableProps) => {
  const animatedValue = React.useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    Animated.timing(animatedValue, {
      toValue: 0.7,
      duration: 100,
      useNativeDriver: true,
    }).start();
  };

  const onPressOut = () => {
    Animated.timing(animatedValue, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      {...props}
    >
      <Animated.View style={[style as any, { opacity: animatedValue }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
};

interface ItemCardProps {
  item: any;
  isSelected: boolean;
  aliases: string[];
  compactMode: boolean;
  selectionMode: boolean;
  onLongPress: (id: string) => void;
  onPress: (id: string) => void;
  onEdit: (item: any) => void;
  t: (key: string, params?: any) => string;
  language: 'en' | 'ar';
}

const ItemCard = React.memo(function ItemCard({
  item,
  isSelected,
  aliases,
  compactMode,
  selectionMode,
  onLongPress,
  onPress,
  onEdit,
  t,
  language,
}: ItemCardProps) {
  return (
    <TouchableOpacity 
      style={[styles.itemCard, compactMode && styles.itemCardCompact, isSelected && styles.cardSelected]}
      onLongPress={() => onLongPress(item.id)}
      onPress={() => onPress(item.id)}
      activeOpacity={0.8}
    >
      <View style={styles.cardContentWrapper}>
        <View style={[styles.itemHeader, compactMode && styles.itemHeaderCompact]}>
          <View style={{ alignItems: 'flex-start', flexShrink: 1, marginEnd: 10 }}>
            <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.itemName, compactMode && styles.itemNameCompact]}>{item.name}</Text>
            {aliases.length > 0 && <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.aliasesText, compactMode && styles.textExtraSmall]}>{t('people.aka')} {aliases.join(', ')}</Text>}
          </View>
          {!selectionMode && (
            <TouchableOpacity onPress={() => onEdit(item)} style={[styles.iconBtn, compactMode && styles.paddingSmall]}>
              <FontAwesome name="pencil" size={compactMode ? 14 : 18} color={ACCENT_GOLD} />
            </TouchableOpacity>
          )}
        </View>
        <View style={[styles.itemDetails, compactMode && styles.itemDetailsCompact, { alignItems: 'flex-start' }]}>
          <Text style={[styles.detailText, compactMode && styles.textExtraSmall]}>{t('stats.detailsPrice')} {item.defaultPrice ? `$${item.defaultPrice}` : t('stats.na')}</Text>
          <Text style={[styles.detailText, compactMode && styles.textExtraSmall]}>{t('stats.detailsSource')} {item.source || t('stats.na')}</Text>
          <Text style={[styles.detailText, compactMode && styles.textExtraSmall]}>{t('stats.detailsTiming')} {item.timing || t('stats.na')}</Text>
          <Text style={[styles.detailText, compactMode && styles.textExtraSmall]}>{t('stats.detailsLastOrdered')} {item.lastOrderedAt ? formatDateTime(item.lastOrderedAt, language) : t('stats.na')}</Text>
        </View>
      </View>

      {selectionMode && (
        <View style={styles.checkboxContainer}>
          <FontAwesome name={isSelected ? "check-circle" : "circle-thin"} size={24} color={isSelected ? ACCENT_GOLD : "#888"} />
        </View>
      )}
    </TouchableOpacity>
  );
});

interface StringEntityCardProps {
  name: string;
  type: 'Place' | 'Source';
  isSelected: boolean;
  aliases: string[];
  compactMode: boolean;
  selectionMode: boolean;
  onLongPress: (name: string) => void;
  onPress: (name: string) => void;
  onEdit: (entity: { type: 'Place' | 'Source', name: string }) => void;
  t: (key: string, params?: any) => string;
}

const StringEntityCard = React.memo(function StringEntityCard({
  name,
  type,
  isSelected,
  aliases,
  compactMode,
  selectionMode,
  onLongPress,
  onPress,
  onEdit,
  t,
}: StringEntityCardProps) {
  return (
    <TouchableOpacity 
      style={[styles.itemCard, compactMode && styles.itemCardCompact, isSelected && styles.cardSelected]}
      onLongPress={() => onLongPress(name)}
      onPress={() => onPress(name)}
      activeOpacity={0.8}
    >
      <View style={styles.cardContentWrapper}>
        <View style={[styles.itemHeader, compactMode && styles.itemHeaderCompact]}>
          <View style={{ alignItems: 'flex-start', flexShrink: 1, marginEnd: 10 }}>
            <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.itemName, compactMode && styles.itemNameCompact]}>{name}</Text>
            {aliases.length > 0 && <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.aliasesText, compactMode && styles.textExtraSmall]}>{t('people.aka')} {aliases.join(', ')}</Text>}
          </View>
          {!selectionMode && (
            <TouchableOpacity onPress={() => onEdit({ type, name })} style={[styles.iconBtn, compactMode && styles.paddingSmall]}>
              <FontAwesome name="pencil" size={compactMode ? 14 : 18} color={ACCENT_GOLD} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {selectionMode && (
        <View style={styles.checkboxContainer}>
          <FontAwesome name={isSelected ? "check-circle" : "circle-thin"} size={24} color={isSelected ? ACCENT_GOLD : "#888"} />
        </View>
      )}
    </TouchableOpacity>
  );
});
