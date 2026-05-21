import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import CreateItemModal from '@/components/CreateItemModal';
import DropdownSelect from '@/components/DropdownSelect';
import PersonModal from '@/components/PersonModal';
import { Text, View, TextInput } from '@/components/Themed';
import { db } from '@/db';
import { api } from '@/db/api';
import { items, orderItems, orders, personAliases, persons, itemAliases } from '@/db/schema';
import { extractDateValue, formatDateLabel, getDefaultDate, getLocalDateString } from '@/utils/dates';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, Keyboard, I18nManager } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSettings } from '@/utils/settings';
import { useTranslation } from '@/utils/i18n';
import SmartTextInput from '@/components/SmartTextInput';
import { COMMON_GROCERY_CORPUS, COMMON_NAMES_CORPUS } from '@/utils/textMatching';
import { ACCENT_GOLD, LIGHT_GOLD } from '@/constants/Colors';

export default function AddOrderScreen() {
  const { data: people } = useLiveQuery(db.select().from(persons));
  const { data: allAliases } = useLiveQuery(db.select().from(personAliases));
  const { data: catalog } = useLiveQuery(db.select().from(items));
  const { data: itemAliasesList } = useLiveQuery(db.select().from(itemAliases));
  const { data: allOrders } = useLiveQuery(db.select().from(orders));
  const { data: allOrderItems } = useLiveQuery(db.select().from(orderItems));
  const [refreshKey, setRefreshKey] = useState(0);
  const { settings } = useSettings();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ personId?: string; date?: string; edit?: string }>();
  const router = useRouter();

  const [targetDate, setTargetDate] = useState(getDefaultDate());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [cart, setCart] = useState<{ item: any; quantity: number }[]>([]);
  
  // Item search state
  const [searchQuery, setSearchQuery] = useState('');
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [activeSearch, setActiveSearch] = useState<'person' | 'item' | 'place' | null>(null);

  // Person search state
  const [personSearchQuery, setPersonSearchQuery] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  // Delivery place
  const [deliveryPlace, setDeliveryPlace] = useState('');

  // Create person modal
  const [personModalVisible, setPersonModalVisible] = useState(false);

  const [editModeOrderId, setEditModeOrderId] = useState<string | null>(null);
  const [topItems, setTopItems] = useState<any[]>([]);

  const targetDateDb = getLocalDateString(targetDate);
  const existingOrder = useMemo(() => {
    if (!allOrders || !selectedPersonId) return null;
    return allOrders.find(o => o.personId === selectedPersonId && o.targetDate === targetDateDb);
  }, [allOrders, selectedPersonId, targetDateDb]);

  React.useEffect(() => {
    if (params.edit && params.personId && params.date) {
      const d = new Date(params.date);
      if (!isNaN(d.getTime())) {
        setTargetDate(d);
        setSelectedPersonId(params.personId);
        setEditModeOrderId(null); // Force reset to allow re-loading
      }
    }
  }, [params.edit, params.personId, params.date]);

  React.useEffect(() => {
    if (params.edit && existingOrder && !editModeOrderId) {
      handleLoadExistingOrder();
      // Clear the edit param so we don't re-trigger on tab switch
      router.setParams({ edit: undefined });
    }
  }, [existingOrder, params.edit, editModeOrderId]);

  React.useEffect(() => {
    if (selectedPersonId) {
      api.getTopItemsForPerson(selectedPersonId)
        .then(setTopItems)
        .catch(err => {
          console.error('Error fetching top items:', err);
          setTopItems([]);
        });
    } else {
      setTopItems([]);
    }
  }, [selectedPersonId]);

  const personCorpus = useMemo(() => {
    const dbNames = people?.map(p => p.name) || [];
    const dbAliases = allAliases?.map(a => a.alias) || [];
    return [...new Set([...dbNames, ...dbAliases, ...COMMON_NAMES_CORPUS])];
  }, [people, allAliases]);

  const itemCorpus = useMemo(() => {
    const dbItems = catalog?.map(i => i.name) || [];
    return [...new Set([...dbItems, ...COMMON_GROCERY_CORPUS])];
  }, [catalog]);

  const placesCorpus = useMemo(() => {
    return [...new Set(people?.map(p => p.typicalPlace).filter((p): p is string => !!p) || [])];
  }, [people]);

  const filteredPlaces = useMemo(() => {
    if (!deliveryPlace.trim()) return [];
    return placesCorpus.filter(p => p.toLowerCase().includes(deliveryPlace.toLowerCase()) && p.toLowerCase() !== deliveryPlace.toLowerCase());
  }, [deliveryPlace, placesCorpus]);

  const handleBlur = () => {
    setTimeout(() => setActiveSearch(null), 150);
  };

  const handleLoadExistingOrder = () => {
    if (!existingOrder) return;
    
    if (existingOrder.isPaid) {
      Alert.alert(
        t('addOrder.editPaidTitle'),
        t('addOrder.editPaidMsg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('addOrder.markUnpaid'),
            onPress: async () => {
              try {
                await api.markOrderUnpaid(existingOrder.id, existingOrder.personId);
                loadExistingOrder();
              } catch (e) {
                console.error(e);
              }
            }
          },
          {
            text: t('addOrder.keepPaid'),
            onPress: () => loadExistingOrder()
          }
        ]
      );
    } else {
      loadExistingOrder();
    }
  };

  const loadExistingOrder = () => {
    if (!existingOrder || !allOrderItems || !catalog) return;
    const itemsForOrder = allOrderItems.filter(oi => oi.orderId === existingOrder.id);
    const newCart = itemsForOrder.map(oi => {
      const itemDef = catalog.find(c => c.id === oi.itemId);
      return { item: itemDef, quantity: oi.quantity };
    }).filter(c => c.item);
    
    setCart(newCart);
    setEditModeOrderId(existingOrder.id);
    if (existingOrder.deliveryPlace) {
      setDeliveryPlace(existingOrder.deliveryPlace);
    }
  };

  const selectPerson = (personId: string) => {
    setSelectedPersonId(personId);
    const person = people?.find(p => p.id === personId);
    if (person?.typicalPlace) setDeliveryPlace(person.typicalPlace);
    setActiveSearch(null);
  };

  const selectedPerson = useMemo(() => people?.find(p => p.id === selectedPersonId), [people, selectedPersonId]);

  const addToCart = (itemObj: any) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.item.id === itemObj.id);
      if (existing) {
        return prev.map((i) => (i.item.id === itemObj.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { item: itemObj, quantity: 1 }];
    });
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.item.id === itemId);
      if (existing && existing.quantity > 1) {
        return prev.map((i) => (i.item.id === itemId ? { ...i, quantity: i.quantity - 1 } : i));
      }
      return prev.filter((i) => i.item.id !== itemId);
    });
  };

  const handleSaveOrder = async () => {
    if (!selectedPersonId) {
      Alert.alert(t('common.error'), t('addOrder.errorNoPerson'));
      return;
    }
    
    if (existingOrder && editModeOrderId !== existingOrder.id) {
      Alert.alert(t('common.error'), t('addOrder.errorExists'));
      return;
    }

    if (cart.length === 0) {
      if (editModeOrderId) {
        Alert.alert(
          t('addOrder.deleteOrder'),
          t('addOrder.emptyOrderPrompt'),
          [
            { text: t('addOrder.keepEditing'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: async () => {
                try {
                  await api.deleteOrder(editModeOrderId);
                  setCart([]);
                  setSelectedPersonId(null);
                  setPersonSearchQuery('');
                  setEditModeOrderId(null);
                  setDeliveryPlace('');
                } catch (e) {
                  console.error(e);
                  Alert.alert(t('common.error'), t('run.failedDelete'));
                }
              },
            },
          ]
        );
        return;
      }
      Alert.alert(t('common.error'), t('addOrder.errorEmptyCart'));
      return;
    }

    try {
      const orderLines = cart.map((c) => ({
          itemId: c.item.id,
          quantity: c.quantity,
          unitPrice: c.item.defaultPrice ?? null,
      }));

      if (editModeOrderId) {
        await api.updateOrder(editModeOrderId, selectedPersonId, orderLines, deliveryPlace || null);
        Alert.alert(t('common.success'), t('addOrder.successUpdate'));
      } else {
        await api.createOrder(selectedPersonId, targetDateDb, orderLines, deliveryPlace || null);
        Alert.alert(t('common.success'), t('addOrder.successSave'));
      }
      
      setCart([]);
      setSelectedPersonId(null);
      setPersonSearchQuery('');
      setEditModeOrderId(null);
      setDeliveryPlace('');
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), t('addOrder.errorSave'));
    }
  };

  const handleCreateItemSubmit = async (name: string, defaultPrice: number | null, source: string | null, timing: 'Fresh' | 'Anytime', isCorrection: boolean, aliases: string[]) => {
    setItemModalVisible(false);
    try {
      const newItem = await api.addItem(name, defaultPrice, source, timing, aliases);
      if (newItem && newItem.length > 0) {
        addToCart(newItem[0]);
        setSearchQuery('');
      }
    } catch (e) {
      Alert.alert(t('common.error'), t('addOrder.errorCreateItem'));
    }
  };

  const handleCreatePersonDone = (newPersonId?: string) => {
    setPersonModalVisible(false);
    if (newPersonId) {
      selectPerson(newPersonId);
      setPersonSearchQuery('');
    }
  };

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setTargetDate(selectedDate);
      setEditModeOrderId(null);
    }
  };

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const baseList = catalog || [];

    if (!q) {
      // Prioritize top items when query is empty
      const topIds = new Set(topItems.map(i => i.id));
      const remaining = baseList.filter(i => !topIds.has(i.id));
      return [...topItems, ...remaining];
    }

    return baseList.filter((item) => {
      const aliases = itemAliasesList?.filter(a => a.itemId === item.id).map(a => a.alias) || [];
      const searchString = [
        item.name,
        item.defaultPrice?.toString(),
        item.source,
        item.timing,
        ...aliases
      ].join(' ').toLowerCase();
      return searchString.includes(q);
    });
  }, [catalog, searchQuery, itemAliasesList, topItems]);
  
  const exactItemMatch = filteredCatalog.find(i => i.name.toLowerCase() === searchQuery.toLowerCase().trim());

  const filteredPeople = useMemo(() => {
    if (!people || !personSearchQuery.trim()) return [];
    const q = personSearchQuery.toLowerCase().trim();

    // Get person IDs that match by alias
    const aliasMatchedIds = new Set(
      allAliases
        ?.filter(a => a.alias.toLowerCase().includes(q))
        .map(a => a.personId) || []
    );

    return people.filter(p => {
      const searchString = [
        p.name,
        p.typicalPlace,
        ...Array.from(allAliases?.filter(a => a.personId === p.id).map(a => a.alias) || [])
      ].join(' ').toLowerCase();
      
      return searchString.includes(q) || aliasMatchedIds.has(p.id);
    });
  }, [people, allAliases, personSearchQuery]);

  const exactPersonMatch = useMemo(() => {
    const q = personSearchQuery.toLowerCase().trim();
    if (!q) return undefined;
    const byName = people?.find(p => p.name.toLowerCase() === q);
    if (byName) return byName;
    const aliasMatch = allAliases?.find(a => a.alias.toLowerCase() === q);
    if (aliasMatch) return people?.find(p => p.id === aliasMatch.personId);
    return undefined;
  }, [people, allAliases, personSearchQuery]);

  const getMatchingAlias = (personId: string): string | null => {
    if (!personSearchQuery.trim()) return null;
    const q = personSearchQuery.toLowerCase().trim();
    const person = people?.find(p => p.id === personId);
    if (person && person.name.toLowerCase().includes(q)) return null;
    const match = allAliases?.find(a => a.personId === personId && a.alias.toLowerCase().includes(q));
    return match?.alias || null;
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        {activeSearch && (
          <TouchableOpacity 
            style={[styles.exitSearchBtn, settings.compactMode && styles.exitSearchBtnCompact]} 
            onPress={() => {
              setActiveSearch(null);
              Keyboard.dismiss();
            }}
          >
            <FontAwesome name={I18nManager.isRTL ? "chevron-right" : "chevron-left"} size={settings.compactMode ? 12 : 14} color={ACCENT_GOLD} />
            <Text style={[styles.exitSearchText, settings.compactMode && styles.textSmall]}>{t('addOrder.exitSearch')}</Text>
          </TouchableOpacity>
        )}

        {(!activeSearch || activeSearch === 'person') && (
          <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
            <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('addOrder.step1Title')}</Text>
            <View style={[styles.searchRow, settings.compactMode && styles.searchRowCompact]}>
              <SmartTextInput
                containerStyle={{ flex: 1 }}
                style={[styles.input, settings.compactMode && styles.inputCompact, { marginBottom: 0 }]}
                value={personSearchQuery}
                onChangeText={setPersonSearchQuery}
                onFocus={() => setActiveSearch('person')}
                onBlur={handleBlur}
                placeholder={t('addOrder.searchPersonPlaceholder')}
                placeholderTextColor="#888"
                corpus={personCorpus}
                compactMode={settings.compactMode}
              />
              {personSearchQuery.trim().length > 0 && !exactPersonMatch && (
                <TouchableOpacity style={[styles.addButton, settings.compactMode && styles.addButtonCompact]} onPress={() => setPersonModalVisible(true)}>
                  <Text style={[styles.addButtonText, settings.compactMode && styles.textExtraSmall]}>{t('addOrder.addBtn')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {activeSearch === 'person' && filteredPeople.length > 0 && (
              <View style={[styles.grid, settings.compactMode && styles.gridCompact, { marginTop: 10 }]}>
                {filteredPeople.map((p) => {
                  const matchedAlias = getMatchingAlias(p.id);
                  return (
                    <TouchableOpacity key={p.id} style={[styles.gridItemPerson, settings.compactMode && styles.gridItemPersonCompact]} onPress={() => selectPerson(p.id)}>
                      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.gridItemName, settings.compactMode && styles.textSmall]}>{p.name}</Text>
                      {matchedAlias && (
                        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.gridItemAlias}>({matchedAlias})</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {!activeSearch && selectedPerson && (
              <View style={[styles.selectedRow, settings.compactMode && styles.selectedRowCompact]}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.selectedText, settings.compactMode && styles.textSmall, { flexShrink: 1, marginEnd: 10 }]}>{selectedPerson.name}</Text>
                <TouchableOpacity onPress={() => { setSelectedPersonId(null); setPersonSearchQuery(''); }}>
                  <Text style={[styles.changeBtnText, settings.compactMode && styles.textExtraSmall]}>{t('addOrder.changeBtn')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {!activeSearch && (
          <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
            <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('addOrder.step2Title')}</Text>
            <TouchableOpacity onPress={() => setShowDatePicker(true)} style={[styles.dateDisplay, settings.compactMode && styles.dateDisplayCompact]}>
              <Text style={[styles.dateDisplayText, settings.compactMode && styles.textSmall]}>{formatDateLabel(targetDate, t, t('modals.daysShort'))}</Text>
              <FontAwesome name="calendar" size={16} color={ACCENT_GOLD} />
            </TouchableOpacity>
          </View>
        )}

        {showDatePicker && <DateTimePicker value={targetDate} mode="date" display="default" onChange={onDateChange} />}

        {selectedPersonId && (!activeSearch || activeSearch === 'place') && (
          <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
            <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('addOrder.stepDeliverToTitle')}</Text>
            <TextInput
              style={[styles.input, settings.compactMode && styles.inputCompact]}
              value={deliveryPlace}
              onChangeText={setDeliveryPlace}
              onFocus={() => setActiveSearch('place')}
              onBlur={handleBlur}
              placeholder={t('addOrder.deliveryPlaceholder')}
              placeholderTextColor="#888"
            />
            {activeSearch === 'place' && filteredPlaces.length > 0 && (
              <View style={styles.suggestionsContainer}>
                {filteredPlaces.map((s, i) => (
                  <TouchableOpacity key={i} style={styles.suggestionItem} onPress={() => { setDeliveryPlace(s); setActiveSearch(null); }}>
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {!activeSearch && existingOrder && editModeOrderId !== existingOrder.id && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>{t('addOrder.warningExists')}</Text>
            <TouchableOpacity style={styles.loadBtn} onPress={handleLoadExistingOrder}><Text style={styles.loadBtnText}>{t('addOrder.editBtn')}</Text></TouchableOpacity>
          </View>
        )}

        {(!activeSearch || activeSearch === 'item') && (
          <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
            <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('addOrder.step3Title')}</Text>
            <View style={[styles.searchRow, settings.compactMode && styles.searchRowCompact]}>
              <SmartTextInput
                containerStyle={{ flex: 1 }}
                style={[styles.input, settings.compactMode && styles.inputCompact, { marginBottom: 0 }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={() => setActiveSearch('item')}
                onBlur={handleBlur}
                placeholder={t('addOrder.searchItemsPlaceholder')}
                placeholderTextColor="#888"
                corpus={itemCorpus}
                compactMode={settings.compactMode}
              />
              {searchQuery.trim().length > 0 && !exactItemMatch && (
                <TouchableOpacity style={[styles.addButton, settings.compactMode && styles.addButtonCompact]} onPress={() => setItemModalVisible(true)}>
                  <Text style={[styles.addButtonText, settings.compactMode && styles.textExtraSmall]}>{t('addOrder.addBtn')}</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.grid, settings.compactMode && styles.gridCompact]}>
              {(activeSearch === 'item' ? filteredCatalog : filteredCatalog.slice(0, 12)).map((item) => {
                const inCart = cart.find((c) => c.item.id === item.id);
                return (
                  <TouchableOpacity key={item.id} style={[styles.gridItem, settings.compactMode && styles.gridItemCompact]} onPress={() => addToCart(item)}>
                    <Text numberOfLines={2} ellipsizeMode="tail" style={[styles.gridItemName, settings.compactMode && styles.textSmall]}>{item.name}</Text>
                    {inCart && <View style={[styles.badge, settings.compactMode && styles.badgeCompact]}><Text style={styles.badgeText}>{inCart.quantity}</Text></View>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {!activeSearch && cart.length > 0 && (
          <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
            <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('addOrder.cartTitle')}</Text>
            {cart.map((c) => (
              <View key={c.item.id} style={[styles.cartRow, settings.compactMode && styles.cartRowCompact]}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.cartText, settings.compactMode && styles.textSmall, { flexShrink: 1, marginEnd: 10 }]}>{c.item.name}</Text>
                <View style={styles.cartActions}>
                  <TouchableOpacity onPress={() => removeFromCart(c.item.id)} style={[styles.cartBtn, settings.compactMode && styles.cartBtnCompact]}>
                    <FontAwesome name="minus" size={settings.compactMode ? 10 : 12} />
                  </TouchableOpacity>
                  <Text style={[styles.cartQuantity, settings.compactMode && styles.cartQuantityCompact]}>{c.quantity}</Text>
                  <TouchableOpacity onPress={() => addToCart(c.item)} style={[styles.cartBtn, settings.compactMode && styles.cartBtnCompact]}>
                    <FontAwesome name="plus" size={settings.compactMode ? 10 : 12} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {!activeSearch && (
        <TouchableOpacity 
          style={[styles.saveButton, settings.compactMode && styles.saveButtonCompact]} 
          onPress={handleSaveOrder}
        >
          <Text style={[styles.saveButtonText, settings.compactMode && styles.textSmall]}>
            {editModeOrderId ? t('addOrder.saveEdit') : t('addOrder.saveOrder')}
          </Text>
        </TouchableOpacity>
      )}

      <CreateItemModal visible={itemModalVisible} initialName={searchQuery} onCancel={() => setItemModalVisible(false)} onSubmit={handleCreateItemSubmit} />
      <PersonModal visible={personModalVisible} mode="create" initialName={personSearchQuery} onCancel={() => setPersonModalVisible(false)} onDone={handleCreatePersonDone} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#333' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#fff' },
  selectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#333', padding: 12, borderRadius: 8 },
  selectedText: { color: ACCENT_GOLD, fontSize: 18, fontWeight: 'bold' },
  changeBtnText: { color: '#aaa', fontSize: 14 },
  input: { backgroundColor: '#333', color: '#fff', padding: 12, borderRadius: 8, fontSize: 16, marginBottom: 10, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  addButton: { marginStart: 10, backgroundColor: ACCENT_GOLD, padding: 12, borderRadius: 8 },
  addButtonText: { color: '#fff', fontWeight: 'bold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridItem: { backgroundColor: '#444', padding: 15, borderRadius: 10, minWidth: '30%', flexShrink: 1, maxWidth: '48%' },
  gridItemPerson: { backgroundColor: '#444', padding: 10, borderRadius: 20, flexShrink: 1, maxWidth: '48%' },
  gridItemName: { color: '#fff', textAlign: 'center' },
  badge: { position: 'absolute', top: -5, end: -5, backgroundColor: '#ff4444', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  cartRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cartText: { fontSize: 16, color: '#fff', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  cartActions: { flexDirection: 'row', alignItems: 'center' },
  cartBtn: { backgroundColor: '#ccc', padding: 8, borderRadius: 15 },
  cartQuantity: { marginHorizontal: 15, fontSize: 18, color: '#fff' },
  saveButton: { backgroundColor: '#28a745', padding: 20, alignItems: 'center', margin: 15, borderRadius: 10 },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  warningBanner: { backgroundColor: '#4a2f00', padding: 15, marginHorizontal: 15, borderRadius: 8, borderWidth: 1, borderColor: '#ff9800' },
  warningText: { color: '#fff', marginBottom: 10 },
  loadBtn: { backgroundColor: '#ff9800', padding: 10, borderRadius: 5, alignItems: 'center' },
  loadBtnText: { color: '#000', fontWeight: 'bold' },
  dateDisplay: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#333', padding: 12, borderRadius: 8, gap: 10 },
  dateDisplayText: { color: '#fff', fontSize: 16 },
  exitSearchBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 15, backgroundColor: '#1a1a1a', borderBottomWidth: 1, borderBottomColor: '#333' },
  exitSearchText: { color: ACCENT_GOLD, fontWeight: 'bold' },
  exitSearchBtnCompact: { padding: 8 },
  suggestionsContainer: { backgroundColor: '#222', borderRadius: 8, padding: 5, marginTop: 5 },
  suggestionItem: { padding: 10 },
  suggestionText: { color: '#fff' },
  gridItemAlias: { color: LIGHT_GOLD, textAlign: 'center', fontSize: 11, fontStyle: 'italic', marginTop: 2 },
  sectionCompact: { padding: 10 },
  inputCompact: { padding: 8, fontSize: 14 },
  searchRowCompact: { marginBottom: 5 },
  addButtonCompact: { padding: 8 },
  gridCompact: { gap: 6 },
  gridItemCompact: { padding: 10 },
  gridItemPersonCompact: { padding: 6 },
  badgeCompact: { width: 18, height: 18, top: -4, end: -4 },
  dateDisplayCompact: { padding: 8 },
  cartRowCompact: { marginBottom: 6 },
  cartBtnCompact: { padding: 5, borderRadius: 10 },
  cartQuantityCompact: { marginHorizontal: 10, fontSize: 14 },
  saveButtonCompact: { padding: 12, margin: 8 },
  selectedRowCompact: { padding: 8 },
  textSmall: { fontSize: 14 },
  textExtraSmall: { fontSize: 11 },
});
