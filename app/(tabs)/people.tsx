import PersonModal from '@/components/PersonModal';
import MergeModal from '@/components/MergeModal';
import UnknownPriceModal from '@/components/UnknownPriceModal';
import CreditLogModal from '@/components/CreditLogModal';
import PersonOrdersModal from '@/components/PersonOrdersModal';
import { Text, View, TextInput } from '@/components/Themed';
import { db } from '@/db';
import { api } from '@/db/api';
import { orderItems, orders, personAliases, persons, transactions } from '@/db/schema';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { and, eq, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Keyboard, I18nManager, FlatList, Pressable, Animated } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSettings } from '@/utils/settings';
import { useTranslation } from '@/utils/i18n';
import { ACCENT_GOLD, LIGHT_GOLD } from '@/constants/Colors';

interface EditState {
  personId: string;
  name: string;
  typicalPlace: string | null;
  aliases: string[];
  balance: number;
}

export default function PeopleScreen() {
  const { data: peopleList } = useLiveQuery(db.select().from(persons));
  const { data: allAliases } = useLiveQuery(db.select().from(personAliases));
  const { settings } = useSettings();
  const { t, isRTL } = useTranslation();

  // Create person modal
  const [createModalVisible, setCreateModalVisible] = useState(false);

  // Edit person modal
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);

  // Unknown price notes modal
  const [unknownPricePerson, setUnknownPricePerson] = useState<{ id: string; name: string } | null>(null);

  // Credit log modal
  const [logPerson, setLogPerson] = useState<{ id: string; name: string } | null>(null);

  // Orders modal
  const [ordersPerson, setOrdersPerson] = useState<{ id: string; name: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPersons, setSelectedPersons] = useState<Set<string>>(new Set());

  // Merge modal state
  const [mergeModalVisible, setMergeModalVisible] = useState(false);

  // Sorting state
  const [sortBy, setSortBy] = useState<'none' | 'lexical' | 'balance' | 'date'>('none');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const sortedPeople = useMemo(() => {
    if (!peopleList) return [];
    let list = [...peopleList];
    
    if (sortBy === 'lexical') {
      list.sort((a, b) => sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
    } else if (sortBy === 'balance') {
      list.sort((a, b) => sortOrder === 'asc' ? a.balance - b.balance : b.balance - a.balance);
    } else if (sortBy === 'date') {
      // @ts-ignore - createdAt might be missing on very old entries but we added it
      list.sort((a, b) => {
        const da = a.createdAt || '';
        const db = b.createdAt || '';
        return sortOrder === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
      });
    }
    return list;
  }, [peopleList, sortBy, sortOrder]);

  const filteredPeople = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return sortedPeople;

    return sortedPeople.filter(p => {
      const aliases = allAliases?.filter(a => a.personId === p.id).map(a => a.alias) || [];
      const searchString = [
        p.name,
        p.typicalPlace,
        ...aliases
      ].join(' ').toLowerCase();
      return searchString.includes(q);
    });
  }, [sortedPeople, allAliases, searchQuery]);

  const { data: unpaidUnknownPriceItems } = useLiveQuery(
    db.select({ personId: orders.personId })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(
        eq(orderItems.isPaid, false),
        sql`${orderItems.unitPrice} IS NULL`
      ))
  );

  const peopleWithUnknownPrices = useMemo(() => {
    return new Set(unpaidUnknownPriceItems?.map(i => i.personId) || []);
  }, [unpaidUnknownPriceItems]);

  const handleEditPress = (person: typeof peopleList extends (infer T)[] | undefined ? T : never) => {
    if (!person) return;
    const aliases = allAliases?.filter(a => a.personId === person.id).map(a => a.alias) || [];
    setEditState({
      personId: person.id,
      name: person.name,
      typicalPlace: person.typicalPlace,
      aliases,
      balance: person.balance,
    });
    setEditModalVisible(true);
  };

  const getBalanceLabel = (balance: number, hasUnknownPrices: boolean) => {
    if (balance < 0) {
      return t('people.yourMoneyWithThem', { amount: Math.abs(balance).toFixed(2) });
    } else if (balance > 0) {
      return t('people.theirMoneyWithYou', { amount: balance.toFixed(2) });
    } else {
      return hasUnknownPrices ? t('people.awaitingPrices') : t('people.settled');
    }
  };

  const getBalanceColor = (balance: number, hasUnknownPrices: boolean) => {
    if (balance < 0) return '#ff4444';
    if (balance > 0) return '#00C851';
    return hasUnknownPrices ? '#ff9800' : '#aaa';
  };

  const getAliasesForPerson = (personId: string) => {
    return allAliases?.filter(a => a.personId === personId).map(a => a.alias) || [];
  };

  const handleCopyPeople = async () => {
    if (!peopleList) return;

    const allTx = await db.select().from(transactions).orderBy(sql`${transactions.date} DESC`);

    let text = `${t('people.summaryTitle')}\n`;
    text += `${t('people.summarySeparator')}\n\n`;

    peopleList.forEach(p => {
      const hasUnknownPrices = peopleWithUnknownPrices.has(p.id);
      let statusIcon = '✅';
      let balText = '';

      if (p.balance < 0) {
        statusIcon = '❌';
        balText = t('people.youAreOwed', { amount: Math.abs(p.balance).toFixed(2) });
      } else if (p.balance > 0) {
        statusIcon = '✅'; // They have credit with you
        balText = t('people.theyHaveCredit', { amount: p.balance.toFixed(2) });
      } else {
        if (hasUnknownPrices) {
          statusIcon = '❌';
          balText = t('people.awaitingPricesTBD');
        } else {
          statusIcon = '✅';
          balText = t('people.settled');
        }
      }

      text += `${statusIcon} ${p.name}\n`;
      text += `   ${balText}\n`;
      if (p.typicalPlace) text += `   📍 ${p.typicalPlace}\n`;
      
      // Include Logs
      const personTx = allTx.filter(tx => tx.personId === p.id);
      if (personTx.length > 0) {
        text += `   📜 ${t('people.recentLogs')}\n`;
        personTx.slice(0, 5).forEach(tx => {
          const d = new Date(tx.date);
          const weekdays = t('people.daysShort').split(',');
          const day = weekdays[d.getDay()];
          const dateStr = `${day}, ${d.toLocaleDateString(isRTL ? 'ar' : 'en-US')}`;
          const amountStr = tx.amount >= 0 ? `+$${tx.amount.toFixed(2)}` : `-$${Math.abs(tx.amount).toFixed(2)}`;
          text += `     • ${dateStr}: ${amountStr} (${tx.note || tx.type})\n`;
        });
        if (personTx.length > 5) {
          text += `     ${t('people.moreTransactions', { count: personTx.length - 5 })}\n`;
        }
      }

      text += `\n`;
    });

    await Clipboard.setStringAsync(text);
    Alert.alert(t('run.copiedTitle'), t('people.balanceSummaryCopied'));
  };

  const toggleSelection = (id: string) => {
    setSelectedPersons(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  };

  const handleLongPress = (id: string) => {
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedPersons(new Set([id]));
    }
  };

  const handleBulkDelete = () => {
    Alert.alert(
      t('people.deleteConfirmTitle'),
      t('people.deleteConfirmBody', { count: selectedPersons.size }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              for (const id of Array.from(selectedPersons)) {
                await api.deletePerson(id);
              }
              setSelectionMode(false);
              setSelectedPersons(new Set());
            } catch (e) {
              console.error(e);
              Alert.alert(t('common.error'), t('people.deleteError'));
            }
          },
        },
      ]
    );
  };

  const getMergeEntities = () => {
    if (selectedPersons.size !== 2 || !peopleList) return { entityA: null, entityB: null };
    const ids = Array.from(selectedPersons);
    const p1 = peopleList.find(p => p.id === ids[0]);
    const p2 = peopleList.find(p => p.id === ids[1]);
    if (!p1 || !p2) return { entityA: null, entityB: null };
    
    return {
      entityA: { id: p1.id, name: p1.name, details: `Balance: $${p1.balance.toFixed(2)}` },
      entityB: { id: p2.id, name: p2.name, details: `Balance: $${p2.balance.toFixed(2)}` }
    };
  };

  const handleConfirmMerge = async (primaryId: string, secondaryId: string, keepAsAlias: boolean) => {
    await api.mergePersons(primaryId, secondaryId, keepAsAlias);
    setSelectionMode(false);
    setSelectedPersons(new Set());
  };

  const toggleSort = (type: typeof sortBy) => {
    if (sortBy === type) {
      if (sortOrder === 'asc') setSortOrder('desc');
      else setSortBy('none');
    } else {
      setSortBy(type);
      setSortOrder('asc');
    }
  };

  const renderPersonItem = React.useCallback(({ item }: { item: any }) => {
    const aliases = getAliasesForPerson(item.id);
    const isSelected = selectedPersons.has(item.id);
    const hasUnknownPrices = peopleWithUnknownPrices.has(item.id);
    return (
      <PersonCard
        person={item}
        aliases={aliases}
        isSelected={isSelected}
        selectionMode={selectionMode}
        compactMode={settings.compactMode}
        hasUnknownPrices={hasUnknownPrices}
        t={t}
        onLongPress={handleLongPress}
        onPress={(id) => {
          if (selectionMode) toggleSelection(id);
        }}
        onEdit={handleEditPress}
        onOrders={setOrdersPerson}
        onHistory={setLogPerson}
        onUnknownPrice={setUnknownPricePerson}
      />
    );
  }, [selectedPersons, selectionMode, settings.compactMode, peopleWithUnknownPrices, t, allAliases]);

  const renderHeader = React.useCallback(() => {
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

        {!isSearching && !selectionMode && (
          <View style={[styles.headerRow, settings.compactMode && styles.headerRowCompact]}>
            <Text style={[styles.title, settings.compactMode && styles.titleCompact]}>{t('people.title')}</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={handleCopyPeople} style={[styles.copyBtn, settings.compactMode && styles.paddingSmall]}>
                <FontAwesome name="copy" size={settings.compactMode ? 16 : 20} color={ACCENT_GOLD} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.addBtn, settings.compactMode && styles.addBtnCompact]} onPress={() => setCreateModalVisible(true)}>
                <FontAwesome name="plus" size={settings.compactMode ? 12 : 16} color="#fff" />
                <Text style={[styles.addBtnText, settings.compactMode && styles.textExtraSmall]}>{t('people.addPersonBtn')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {selectionMode && (
          <View style={[styles.headerRow, settings.compactMode && styles.headerRowCompact]}>
            <View style={styles.selectionLeft}>
              <TouchableOpacity onPress={() => { setSelectionMode(false); setSelectedPersons(new Set()); }}>
                <FontAwesome name="times" size={settings.compactMode ? 20 : 24} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.selectionTitle}>{selectedPersons.size} {t('run.selected')}</Text>
            </View>
            <View style={styles.headerActions}>
              {selectedPersons.size === 2 && (
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

        <View style={[styles.searchContainer, settings.compactMode && styles.searchContainerCompact]}>
          <TextInput
            style={[styles.searchInput, settings.compactMode && styles.searchInputCompact]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('people.searchPlaceholder')}
            placeholderTextColor="#888"
            onFocus={() => setIsSearching(true)}
            onBlur={() => { if (!searchQuery) setIsSearching(false); }}
          />
        </View>

        {!isSearching && !selectionMode && (
          <View style={[styles.sortBar, settings.compactMode && styles.sortBarCompact]}>
            <Text style={[styles.sortLabel, settings.compactMode && styles.textExtraSmall]}>{t('people.sortLabel')}</Text>
            <FadePressable 
              style={[styles.sortBtn, sortBy === 'lexical' && styles.sortBtnActive, settings.compactMode && styles.sortBtnCompact]} 
              onPress={() => toggleSort('lexical')}
            >
              <FontAwesome 
                name="sort-alpha-asc" 
                size={settings.compactMode ? 12 : 14} 
                color={sortBy === 'lexical' ? "#fff" : "#888"} 
              />
              <Text style={[styles.sortBtnText, sortBy === 'lexical' && styles.sortBtnTextActive, settings.compactMode && styles.textExtraSmall]}>{t('people.sortName')}</Text>
              {sortBy === 'lexical' && (
                <FontAwesome 
                  name={sortOrder === 'asc' ? "caret-up" : "caret-down"} 
                  size={10} 
                  color="#fff" 
                  style={{ marginStart: 2 }} 
                />
              )}
            </FadePressable>
            
            <FadePressable 
              style={[styles.sortBtn, sortBy === 'balance' && styles.sortBtnActive, settings.compactMode && styles.sortBtnCompact]} 
              onPress={() => toggleSort('balance')}
            >
              <FontAwesome 
                name="dollar" 
                size={settings.compactMode ? 12 : 14} 
                color={sortBy === 'balance' ? "#fff" : "#888"} 
              />
              <Text style={[styles.sortBtnText, sortBy === 'balance' && styles.sortBtnTextActive, settings.compactMode && styles.textExtraSmall]}>{t('people.sortBalance')}</Text>
              {sortBy === 'balance' && (
                <FontAwesome 
                  name={sortOrder === 'asc' ? "caret-up" : "caret-down"} 
                  size={10} 
                  color="#fff" 
                  style={{ marginStart: 2 }} 
                />
              )}
            </FadePressable>

            <FadePressable 
              style={[styles.sortBtn, sortBy === 'date' && styles.sortBtnActive, settings.compactMode && styles.sortBtnCompact]} 
              onPress={() => toggleSort('date')}
            >
              <FontAwesome 
                name="clock-o" 
                size={settings.compactMode ? 12 : 14} 
                color={sortBy === 'date' ? "#fff" : "#888"} 
              />
              <Text style={[styles.sortBtnText, sortBy === 'date' && styles.sortBtnTextActive, settings.compactMode && styles.textExtraSmall]}>{t('people.sortAdded')}</Text>
              {sortBy === 'date' && (
                <FontAwesome 
                  name={sortOrder === 'asc' ? "caret-up" : "caret-down"} 
                  size={10} 
                  color="#fff" 
                  style={{ marginStart: 2 }} 
                />
              )}
            </FadePressable>
          </View>
        )}
      </View>
    );
  }, [isSearching, searchQuery, selectionMode, selectedPersons, settings.compactMode, sortBy, sortOrder, t]);

  const renderEmpty = React.useCallback(() => {
    if (peopleList?.length === 0) {
      return <Text style={styles.emptyText}>{t('people.emptyList')}</Text>;
    }
    if (searchQuery.trim() !== '' && filteredPeople.length === 0) {
      return (
        <View style={styles.noResultsContainer}>
          <FontAwesome name="search" size={48} color="#444" style={{ marginBottom: 10 }} />
          <Text style={styles.noResultsText}>{t('people.noMatch', { query: searchQuery })}</Text>
        </View>
      );
    }
    return null;
  }, [peopleList, searchQuery, filteredPeople, t]);

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <FlatList
        data={filteredPeople}
        renderItem={renderPersonItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader()}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[styles.content, settings.compactMode && styles.contentCompact, { paddingBottom: 100 }]}
        keyboardShouldPersistTaps="handled"
      />

      {/* Create Person Modal */}
      <PersonModal
        visible={createModalVisible}
        mode="create"
        onCancel={() => setCreateModalVisible(false)}
        onDone={() => setCreateModalVisible(false)}
      />

      {/* Edit Person Modal */}
      {editState && (
        <PersonModal
          visible={editModalVisible}
          mode="edit"
          personId={editState.personId}
          initialName={editState.name}
          initialPlace={editState.typicalPlace}
          initialAliases={editState.aliases}
          initialBalance={editState.balance}
          onCancel={() => { setEditModalVisible(false); setEditState(null); }}
          onDone={() => { setEditModalVisible(false); setEditState(null); }}
        />
      )}
      {/* Unknown Price Notes Modal */}
      {unknownPricePerson && (
        <UnknownPriceModal
          visible={!!unknownPricePerson}
          personId={unknownPricePerson.id}
          personName={unknownPricePerson.name}
          onClose={() => setUnknownPricePerson(null)}
        />
      )}
      
      {/* Credit Log Modal */}
      {logPerson && (
        <CreditLogModal
          visible={!!logPerson}
          personId={logPerson.id}
          personName={logPerson.name}
          onClose={() => setLogPerson(null)}
        />
      )}
      {mergeModalVisible && (
        <MergeModal
          visible={mergeModalVisible}
          entityType="Person"
          entityA={getMergeEntities().entityA}
          entityB={getMergeEntities().entityB}
          onClose={() => setMergeModalVisible(false)}
          onConfirm={handleConfirmMerge}
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
  container: { flex: 1 },
  content: { padding: 15 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  copyBtn: { padding: 5 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ACCENT_GOLD,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  card: {
    backgroundColor: '#333',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardSelected: {
    borderColor: ACCENT_GOLD,
    borderWidth: 2,
    backgroundColor: 'rgba(47, 149, 220, 0.1)',
  },
  info: { flex: 1, alignItems: 'flex-start' },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  name: { fontSize: 18, fontWeight: 'bold', color: '#fff', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  personActions: { flexDirection: 'row', gap: 12 },
  iconBtn: {
    padding: 6,
  },
  place: {
    fontSize: 13,
    color: LIGHT_GOLD,
    marginBottom: 3,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  aliases: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    marginBottom: 3,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  balance: { fontSize: 14, fontWeight: '600', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  notesBtn: {
    padding: 4,
  },
  emptyText: { color: '#888', fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
  checkboxContainer: { padding: 10 },
  selectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  selectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  bulkDeleteBtn: { backgroundColor: '#ff4444', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  mergeBtn: { backgroundColor: '#ff9800', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
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
  
  // Compact Modifiers
  contentCompact: { padding: 8 },
  headerRowCompact: { marginBottom: 12 },
  titleCompact: { fontSize: 20 },
  addBtnCompact: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  compactBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  cardCompact: { padding: 10, marginBottom: 8 },
  nameRowCompact: { marginBottom: 2 },
  nameCompact: { fontSize: 16 },
  balanceRowCompact: { marginTop: 0 },
  textSmall: { fontSize: 13 },
  textExtraSmall: { fontSize: 11 },
  paddingSmall: { padding: 2 },
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
    paddingVertical: 6,
    fontSize: 14,
  },
  searchContainerCompact: {
    marginBottom: 8,
  },
  sortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 15,
  },
  sortBarCompact: {
    marginBottom: 10,
    gap: 5,
  },
  sortLabel: {
    color: '#666',
    fontSize: 12,
    fontWeight: 'bold',
    marginEnd: 4,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
    gap: 6,
  },
  sortBtnCompact: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
  },
  sortBtnActive: {
    backgroundColor: ACCENT_GOLD,
    borderColor: ACCENT_GOLD,
  },
  sortBtnText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  sortBtnTextActive: {
    color: '#fff',
  },
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

interface PersonCardProps {
  person: any;
  aliases: string[];
  isSelected: boolean;
  selectionMode: boolean;
  compactMode: boolean;
  hasUnknownPrices: boolean;
  t: (key: string, params?: any) => string;
  onLongPress: (id: string) => void;
  onPress: (id: string) => void;
  onEdit: (person: any) => void;
  onOrders: (personInfo: { id: string; name: string }) => void;
  onHistory: (personInfo: { id: string; name: string }) => void;
  onUnknownPrice: (personInfo: { id: string; name: string }) => void;
}

const getCardBalanceLabel = (balance: number, hasUnknownPrices: boolean, t: any) => {
  if (balance < 0) {
    return t('people.yourMoneyWithThem', { amount: Math.abs(balance).toFixed(2) });
  } else if (balance > 0) {
    return t('people.theirMoneyWithYou', { amount: balance.toFixed(2) });
  } else {
    return hasUnknownPrices ? t('people.awaitingPrices') : t('people.settled');
  }
};

const getCardBalanceColor = (balance: number, hasUnknownPrices: boolean) => {
  if (balance < 0) return '#ff4444';
  if (balance > 0) return '#00C851';
  return hasUnknownPrices ? '#ff9800' : '#aaa';
};

const PersonCard = React.memo(function PersonCard({
  person,
  aliases,
  isSelected,
  selectionMode,
  compactMode,
  hasUnknownPrices,
  t,
  onLongPress,
  onPress,
  onEdit,
  onOrders,
  onHistory,
  onUnknownPrice,
}: PersonCardProps) {
  const balanceColor = getCardBalanceColor(person.balance, hasUnknownPrices);
  const balanceLabel = getCardBalanceLabel(person.balance, hasUnknownPrices, t);

  return (
    <TouchableOpacity 
      style={[
        styles.card, 
        compactMode && styles.cardCompact,
        isSelected && styles.cardSelected
      ]}
      onLongPress={() => onLongPress(person.id)}
      onPress={() => onPress(person.id)}
      activeOpacity={0.8}
    >
      <View style={styles.info}>
        <View style={[styles.nameRow, compactMode && styles.nameRowCompact]}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.name, compactMode && styles.nameCompact, { flexShrink: 1, marginEnd: 10 }]}>{person.name}</Text>
          <View style={styles.personActions}>
            <TouchableOpacity onPress={() => onHistory({ id: person.id, name: person.name })} style={[styles.iconBtn, compactMode && styles.paddingSmall]}>
              <FontAwesome name="history" size={compactMode ? 14 : 18} color={ACCENT_GOLD} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onOrders({ id: person.id, name: person.name })} style={[styles.iconBtn, compactMode && styles.paddingSmall]}>
              <FontAwesome name="shopping-cart" size={compactMode ? 14 : 18} color={ACCENT_GOLD} />
            </TouchableOpacity>
            {!selectionMode && (
              <TouchableOpacity onPress={() => onEdit(person)} style={[styles.iconBtn, compactMode && styles.paddingSmall]}>
                <FontAwesome name="pencil" size={compactMode ? 14 : 18} color={ACCENT_GOLD} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {person.typicalPlace ? (
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.place, compactMode && styles.textExtraSmall, { alignSelf: 'flex-start' }]}>📍 {person.typicalPlace}</Text>
        ) : null}
        {aliases.length > 0 ? (
          <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.aliases, compactMode && styles.textExtraSmall, { alignSelf: 'flex-start' }]}>
            {t('people.aka')} {aliases.join(', ')}
          </Text>
        ) : null}
        <View style={[styles.balanceRow, compactMode && styles.balanceRowCompact, { alignSelf: 'flex-start' }]}>
          <Text style={[styles.balance, compactMode && styles.textSmall, { color: balanceColor }]}>
            {balanceLabel}
          </Text>
          {hasUnknownPrices && (
            <TouchableOpacity
              onPress={() => onUnknownPrice({ id: person.id, name: person.name })}
              style={[styles.notesBtn, compactMode && styles.paddingSmall]}>
              <FontAwesome name="exclamation-circle" size={compactMode ? 14 : 18} color="#ff9800" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {selectionMode && (
        <View style={styles.checkboxContainer}>
          <FontAwesome 
            name={isSelected ? "check-circle" : "circle-thin"} 
            size={24} 
            color={isSelected ? ACCENT_GOLD : "#888"} 
          />
        </View>
      )}
    </TouchableOpacity>
  );
});
