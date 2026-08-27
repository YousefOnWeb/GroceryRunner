import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import CreateItemModal from '@/components/CreateItemModal';
import PersonModal from '@/components/PersonModal';
import { Text, View, TextInput } from '@/components/Themed';
import { db } from '@/db';
import { api } from '@/db/api';
import { items, orderItems, orders, personAliases, persons, itemAliases, tasks } from '@/db/schema';
import { formatDateLabel, getDefaultDate, getLocalDateString } from '@/utils/dates';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React, { useMemo, useState, useEffect } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, Keyboard, I18nManager, Switch } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSettings } from '@/utils/settings';
import { useTranslation } from '@/utils/i18n';
import { ACCENT_GOLD, LIGHT_GOLD } from '@/constants/Colors';

const InfoIcon = ({ title, message }: { title: string, message: string }) => (
  <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => Alert.alert(title, message)} style={{ marginLeft: 5 }}>
    <FontAwesome name="question-circle-o" size={14} color="#888" />
  </TouchableOpacity>
);

export default function AddOrderScreen() {
  const { data: people } = useLiveQuery(db.select().from(persons));
  const { data: allAliases } = useLiveQuery(db.select().from(personAliases));
  const { data: catalog } = useLiveQuery(db.select().from(items));
  const { data: itemAliasesList } = useLiveQuery(db.select().from(itemAliases));
  const { data: allOrders } = useLiveQuery(db.select().from(orders));
  const { data: allOrderItems } = useLiveQuery(db.select().from(orderItems));
  const { data: allTasks } = useLiveQuery(db.select().from(tasks));

  const { settings } = useSettings();
  const { t, isRTL } = useTranslation();
  const params = useLocalSearchParams<{ personId?: string; date?: string; edit?: string; mode?: string; editTaskId?: string }>();
  const router = useRouter();

  // Mode state
  const [formMode, setFormMode] = useState<'order' | 'task'>('order');

  // Shared state
  const [targetDate, setTargetDate] = useState<Date>(getDefaultDate());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Person search state
  const [personSearchQuery, setPersonSearchQuery] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  // Create modals
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [personModalVisible, setPersonModalVisible] = useState(false);

  // ORDER STATE
  const [cart, setCart] = useState<{ item: any; quantity: number }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [deliveryPlace, setDeliveryPlace] = useState('');
  const [editModeOrderId, setEditModeOrderId] = useState<string | null>(null);
  const [topItems, setTopItems] = useState<any[]>([]);

  // TASK STATE
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [requiresMeeting, setRequiresMeeting] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [targetTime, setTargetTime] = useState<Date | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const targetDateDb = getLocalDateString(targetDate);
  const existingOrder = useMemo(() => {
    if (!allOrders || !selectedPersonId) return null;
    return allOrders.find(o => o.personId === selectedPersonId && o.targetDate === targetDateDb);
  }, [allOrders, selectedPersonId, targetDateDb]);

  // Handle URL Params mapping
  useEffect(() => {
    if (params.mode === 'task') setFormMode('task');
    else if (params.mode === 'order') setFormMode('order');

    if (params.editTaskId) {
      setFormMode('task');
      setEditTaskId(params.editTaskId);
    }
  }, [params.mode, params.editTaskId]);

  useEffect(() => {
    if (params.edit && params.personId && params.date && !params.editTaskId) {
      const d = new Date(params.date);
      if (!isNaN(d.getTime())) {
        setTargetDate(d);
        setSelectedPersonId(params.personId);
        setEditModeOrderId(null); // Force reset to allow re-loading
        setFormMode('order');
      }
    }
  }, [params.edit, params.personId, params.date, params.editTaskId]);

  // Auto-load order when selecting a person for an existing date
  useEffect(() => {
    if (formMode === 'order' && params.edit && existingOrder && !editModeOrderId) {
      handleLoadExistingOrder();
      router.setParams({ edit: undefined });
    }
  }, [existingOrder, params.edit, editModeOrderId, formMode]);

  // Load Task for editing
  useEffect(() => {
    if (formMode === 'task' && editTaskId && allTasks) {
      const task = allTasks.find(t => t.id === editTaskId);
      if (task) {
        setTaskTitle(task.title || '');
        setRequiresMeeting(task.type === 'meetup_task');
        setSelectedPersonId(task.personId || null);
        if (task.personId) {
          const p = people?.find(p => p.id === task.personId);
          setPersonSearchQuery(p ? p.name : '');
        } else {
          setPersonSearchQuery('');
        }
        
        if (task.targetDate) {
          const [year, month, day] = task.targetDate.split('-').map(Number);
          setTargetDate(new Date(year, month - 1, day));
        } else {
          setTargetDate(getDefaultDate()); // default to today if null
        }
        
        if (task.targetTime) {
          const [hours, minutes] = task.targetTime.split(':').map(Number);
          const d = new Date();
          d.setHours(hours, minutes, 0, 0);
          setTargetTime(d);
        } else {
          setTargetTime(null);
        }
        
        setDeliveryPlace(task.locationPlace || '');
      }
    }
  }, [formMode, editTaskId, allTasks, people]);

  // Fetch top items for order
  useEffect(() => {
    if (selectedPersonId && formMode === 'order') {
      api.getTopItemsForPerson(selectedPersonId)
        .then(setTopItems)
        .catch(err => {
          console.error('Error fetching top items:', err);
          setTopItems([]);
        });
    } else {
      setTopItems([]);
    }
  }, [selectedPersonId, formMode]);


  const placesCorpus = useMemo(() => {
    return [...new Set(people?.map(p => p.typicalPlace).filter((p): p is string => !!p) || [])];
  }, [people]);

  const filteredPlaces = useMemo(() => {
    if (!deliveryPlace.trim()) return [];
    return placesCorpus.filter(p => p.toLowerCase().includes(deliveryPlace.toLowerCase()) && p.toLowerCase() !== deliveryPlace.toLowerCase());
  }, [deliveryPlace, placesCorpus]);

  const handleLoadExistingOrder = () => {
    if (!existingOrder) return;
    loadExistingOrder();
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
    if (person?.typicalPlace && !deliveryPlace) setDeliveryPlace(person.typicalPlace);
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

  const resetForm = () => {
    setCart([]);
    setSelectedPersonId(null);
    setPersonSearchQuery('');
    setEditModeOrderId(null);
    setEditTaskId(null);
    setDeliveryPlace('');
    setTaskTitle('');
    setTargetTime(null);
    setRequiresMeeting(false);
    router.setParams({ mode: undefined, editTaskId: undefined, edit: undefined, personId: undefined, date: undefined });
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
                  resetForm();
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
      
      resetForm();
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), t('addOrder.errorSave'));
    }
  };

  const handleSaveTask = async () => {
    if (requiresMeeting && !selectedPersonId) {
      Alert.alert(t('common.error'), t('tasks.errorNoPerson') || 'Please select a person.');
      return;
    }

    if (requiresMeeting && !deliveryPlace.trim()) {
      Alert.alert(t('common.error'), t('addOrder.locationMandatoryError') || 'Location is required when meeting a person.');
      return;
    }

    let finalTitle = taskTitle.trim();

    if (!finalTitle) {
      Alert.alert(t('common.error'), t('tasks.errorNoTitle') || 'Please enter a title or select an item.');
      return;
    }

    try {
      const dateStr = getLocalDateString(targetDate);
      let timeStr = null;
      if (targetTime) {
        timeStr = `${targetTime.getHours().toString().padStart(2, '0')}:${targetTime.getMinutes().toString().padStart(2, '0')}`;
      }
      
      const taskType = requiresMeeting ? 'meetup_task' : 'general_task';

      if (editTaskId) {
        await api.updateTask(editTaskId, {
          title: finalTitle,
          type: taskType,
          personId: requiresMeeting ? selectedPersonId : null,
          targetDate: dateStr,
          targetTime: timeStr,
          locationPlace: requiresMeeting ? deliveryPlace.trim() : null
        });
        Alert.alert(t('common.success'), t('addOrder.successUpdate') || 'Updated successfully.');
      } else {
        await api.addTask(
          finalTitle,
          taskType,
          requiresMeeting ? selectedPersonId : null,
          dateStr,
          timeStr,
          requiresMeeting ? deliveryPlace.trim() : null
        );
        Alert.alert(t('common.success'), t('addOrder.successSave') || 'Saved successfully.');
      }
      resetForm();
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), t('tasks.errorSave') || 'Failed to save task.');
    }
  };

  const handleCreateItemSubmit = async (name: string, defaultPrice: number | null, source: string | null, timing: 'Fresh' | 'Anytime', isCorrection: boolean, aliases: string[]) => {
    setItemModalVisible(false);
    try {
      const newItem = await api.addItem(name, defaultPrice, source, timing, aliases);
      if (newItem && newItem.length > 0) {
        if (formMode === 'order') {
          addToCart(newItem[0]);
          setSearchQuery('');
        }
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
      if (formMode === 'order') setEditModeOrderId(null);
    }
  };

  const onTimeChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowTimePicker(false);
    if (selectedDate) setTargetTime(selectedDate);
  };

  const filteredCatalog = useMemo(() => {
    if (formMode !== 'order') return [];
    const q = searchQuery.toLowerCase().trim();
    const baseList = catalog || [];

    let result = [];
    if (!q) {
      const topIds = new Set(topItems.map(i => i.id));
      const remaining = baseList.filter(i => !topIds.has(i.id));
      result = [...topItems, ...remaining];
    } else {
      result = baseList.filter((item) => {
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
    }

    return result.slice(0, 10);
  }, [catalog, searchQuery, formMode, itemAliasesList, topItems]);
  
  const exactItemMatch = useMemo(() => {
    if (formMode !== 'order') return undefined;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return undefined;
    return filteredCatalog.find(i => i.name.toLowerCase() === q);
  }, [filteredCatalog, searchQuery, formMode]);

  const filteredPeople = useMemo(() => {
    if (!people || !personSearchQuery.trim()) return [];
    const q = personSearchQuery.toLowerCase().trim();

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

  const renderPersonSelection = () => (
    <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
      <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>
        {formMode === 'order' ? t('addOrder.step1Title') : (t('addOrder.step1TaskTitle') || '1. Person met on task')}
      </Text>
      {!selectedPersonId ? (
        <>
          <View style={[styles.searchRow, settings.compactMode && styles.searchRowCompact]}>
            <TextInput
              style={[styles.input, settings.compactMode && styles.inputCompact, { marginBottom: 0, flex: 1 }]}
              value={personSearchQuery}
              onChangeText={setPersonSearchQuery}
              placeholder={t('addOrder.searchPersonPlaceholder')}
              placeholderTextColor="#888"
            />
            {personSearchQuery.trim().length > 0 && !exactPersonMatch && (
              <TouchableOpacity style={[styles.addButton, settings.compactMode && styles.addButtonCompact]} onPress={() => setPersonModalVisible(true)}>
                <Text style={[styles.addButtonText, settings.compactMode && styles.textExtraSmall]}>{t('addOrder.addBtn')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {filteredPeople.length > 0 && (
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
        </>
      ) : selectedPerson && (
        <View style={[styles.selectedRow, settings.compactMode && styles.selectedRowCompact]}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.selectedText, settings.compactMode && styles.textSmall, { flexShrink: 1, marginEnd: 10 }]}>{selectedPerson.name}</Text>
          <TouchableOpacity onPress={() => { setSelectedPersonId(null); setPersonSearchQuery(''); }}>
            <Text style={[styles.changeBtnText, settings.compactMode && styles.textExtraSmall]}>{t('addOrder.changeBtn')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderLocationSelection = () => (
    <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
      <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>
        {formMode === 'order' ? t('addOrder.stepDeliverToTitle') : (t('addOrder.stepPlaceMetAtTitle') || 'Place met at')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <TextInput
            style={[styles.input, settings.compactMode && styles.inputCompact]}
            value={deliveryPlace}
            onChangeText={setDeliveryPlace}
            placeholder={t('addOrder.deliveryPlaceholder')}
            placeholderTextColor="#888"
          />
          {filteredPlaces.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {filteredPlaces.map((s, i) => (
                <TouchableOpacity key={i} style={styles.suggestionItem} onPress={() => { setDeliveryPlace(s); }}>
                  <Text style={styles.suggestionText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );

  const renderOrderForm = () => (
    <>
      {renderPersonSelection()}
      
      <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
        <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('addOrder.step2Title')}</Text>
        <TouchableOpacity onPress={() => setShowDatePicker(true)} style={[styles.dateDisplay, settings.compactMode && styles.dateDisplayCompact]}>
          <Text style={[styles.dateDisplayText, settings.compactMode && styles.textSmall]}>{formatDateLabel(targetDate, t, t('modals.daysShort'))}</Text>
          <FontAwesome name="calendar" size={16} color={ACCENT_GOLD} />
        </TouchableOpacity>
      </View>

      {selectedPersonId && renderLocationSelection()}

      {existingOrder && editModeOrderId !== existingOrder.id && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>{t('addOrder.warningExists')}</Text>
          <TouchableOpacity style={styles.loadBtn} onPress={handleLoadExistingOrder}><Text style={styles.loadBtnText}>{t('addOrder.editBtn')}</Text></TouchableOpacity>
        </View>
      )}

      <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
        <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('addOrder.step3Title')}</Text>
        <View style={[styles.searchRow, settings.compactMode && styles.searchRowCompact]}>
            <TextInput
              style={[styles.input, settings.compactMode && styles.inputCompact, { marginBottom: 0, flex: 1 }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('addOrder.searchItemsPlaceholder')}
              placeholderTextColor="#888"
            />
            {searchQuery.trim().length > 0 && !exactItemMatch && (
              <TouchableOpacity style={[styles.addButton, settings.compactMode && styles.addButtonCompact]} onPress={() => setItemModalVisible(true)}>
                <Text style={[styles.addButtonText, settings.compactMode && styles.textExtraSmall]}>{t('addOrder.addBtn')}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.grid, settings.compactMode && styles.gridCompact]}>
            {filteredCatalog.map((item) => {
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

      {cart.length > 0 && (
        <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
          <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('addOrder.cartTitle')}</Text>
          {cart.map((c) => (
            <View key={c.item.id} style={[styles.cartRow, settings.compactMode && styles.cartRowCompact]}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.cartText, settings.compactMode && styles.textSmall, { flexShrink: 1, marginEnd: 10 }]}>{c.item.name}</Text>
              <View style={styles.stepperContainer}>
                <TouchableOpacity onPress={() => removeFromCart(c.item.id)} style={styles.stepperBtn}>
                  <Text style={styles.stepperBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{c.quantity}</Text>
                <TouchableOpacity onPress={() => addToCart(c.item)} style={styles.stepperBtn}>
                  <Text style={styles.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );

  const renderTaskForm = () => (
    <>
      <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall, { marginBottom: 0 }]}>{t('addOrder.requiresMeeting') || 'Requires Meeting a Person'}</Text>
          <Switch
            value={requiresMeeting}
            onValueChange={setRequiresMeeting}
            trackColor={{ false: '#444', true: ACCENT_GOLD + '80' }}
            thumbColor={requiresMeeting ? ACCENT_GOLD : '#888'}
          />
        </View>
      </View>

      {requiresMeeting && renderPersonSelection()}
      {requiresMeeting && selectedPersonId && renderLocationSelection()}

      <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
        <View>
            <Text style={[styles.label, settings.compactMode && styles.textSmall]}>
              {t('tasks.titleOrDescription') || 'Title / Description'} *
            </Text>
            <TextInput
              style={[styles.input, settings.compactMode && styles.inputCompact]}
              value={taskTitle}
              onChangeText={setTaskTitle}
              placeholder={t('tasks.titlePlaceholder') || 'What needs to be done?'}
              placeholderTextColor="#888"
            />
          </View>
        </View>

      <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
        <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('tasks.dateLabel') || 'Date'}</Text>
          <TouchableOpacity onPress={() => setShowDatePicker(true)} style={[styles.dateDisplay, settings.compactMode && styles.dateDisplayCompact]}>
            <Text style={[styles.dateDisplayText, settings.compactMode && styles.textSmall]}>
              {formatDateLabel(targetDate, t, t('modals.daysShort'))}
            </Text>
            <FontAwesome name="calendar" size={16} color={ACCENT_GOLD} />
          </TouchableOpacity>
        </View>

      <View style={[styles.section, settings.compactMode && styles.sectionCompact]}>
        <Text style={[styles.sectionTitle, settings.compactMode && styles.textSmall]}>{t('tasks.timeLabel') || 'Time'}</Text>
          <TouchableOpacity onPress={() => setShowTimePicker(true)} style={[styles.dateDisplay, settings.compactMode && styles.dateDisplayCompact]}>
            <Text style={[styles.dateDisplayText, settings.compactMode && styles.textSmall, !targetTime && { color: '#888' }]}>
              {targetTime ? `${targetTime.getHours().toString().padStart(2, '0')}:${targetTime.getMinutes().toString().padStart(2, '0')}` : (t('common.none') || 'None')}
            </Text>
            {targetTime ? (
              <TouchableOpacity onPress={() => setTargetTime(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <FontAwesome name="times-circle" size={16} color="#888" />
              </TouchableOpacity>
            ) : (
              <FontAwesome name="clock-o" size={16} color={ACCENT_GOLD} />
            )}
          </TouchableOpacity>
        </View>
    </>
  );

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        
        {/* Toggle Mode Segment */}
        <View style={[styles.modeToggleContainer, settings.compactMode && styles.modeToggleContainerCompact]}>
          <TouchableOpacity 
            style={[styles.modeBtn, formMode === 'order' && styles.modeBtnActive]} 
            onPress={() => setFormMode('order')}
          >
            <Text style={[styles.modeBtnText, formMode === 'order' && styles.modeBtnTextActive]}>
              {t('addOrder.addOrderMode') || 'Add Order'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.modeBtn, formMode === 'task' && styles.modeBtnActive]} 
            onPress={() => setFormMode('task')}
          >
            <Text style={[styles.modeBtnText, formMode === 'task' && styles.modeBtnTextActive]}>
              {t('addOrder.addTaskMode') || 'Add Task'}
            </Text>
          </TouchableOpacity>
        </View>

        {formMode === 'order' ? renderOrderForm() : renderTaskForm()}
      </ScrollView>

      <TouchableOpacity 
          style={[styles.saveButton, settings.compactMode && styles.saveButtonCompact]} 
          onPress={formMode === 'order' ? handleSaveOrder : handleSaveTask}
        >
          <Text style={[styles.saveButtonText, settings.compactMode && styles.textSmall]}>
            {formMode === 'order' 
              ? (editModeOrderId ? t('addOrder.saveEdit') : t('addOrder.saveOrder'))
              : (editTaskId ? t('common.save') : (t('addOrder.addTaskMode') || 'Add Task'))}
          </Text>
        </TouchableOpacity>

      {showDatePicker && <DateTimePicker value={targetDate} mode="date" display="default" onChange={onDateChange} />}
      {showTimePicker && <DateTimePicker value={targetTime || new Date()} mode="time" display="default" onChange={onTimeChange} />}

      <CreateItemModal visible={itemModalVisible} initialName={searchQuery} onCancel={() => setItemModalVisible(false)} onSubmit={handleCreateItemSubmit} />
      <PersonModal visible={personModalVisible} mode="create" initialName={personSearchQuery} onCancel={() => setPersonModalVisible(false)} onDone={handleCreatePersonDone} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modeToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#333',
    margin: 15,
    borderRadius: 12,
    padding: 4,
  },
  modeToggleContainerCompact: {
    margin: 10,
    borderRadius: 8,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: ACCENT_GOLD,
  },
  modeBtnText: {
    color: '#aaa',
    fontWeight: 'bold',
    fontSize: 16,
  },
  modeBtnTextActive: {
    color: '#000',
  },
  label: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 6,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  section: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#333' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#fff', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  selectedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#333', padding: 12, borderRadius: 8 },
  selectedText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
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
  saveButton: { backgroundColor: ACCENT_GOLD, padding: 20, alignItems: 'center', margin: 15, borderRadius: 10, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 2 },
  saveButtonText: { color: '#000', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  warningBanner: { backgroundColor: '#4a2f00', padding: 15, marginHorizontal: 15, borderRadius: 8, borderWidth: 1, borderColor: '#ff9800' },
  warningText: { color: '#fff', marginBottom: 10 },
  loadBtn: { backgroundColor: '#ff9800', padding: 10, borderRadius: 5, alignItems: 'center' },
  loadBtnText: { color: '#000', fontWeight: 'bold' },
  dateDisplay: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#333', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#444' },
  dateDisplayText: { color: '#fff', fontSize: 16 },
  suggestionsContainer: { backgroundColor: '#222', borderRadius: 8, padding: 5, marginTop: 5 },
  suggestionItem: { padding: 10 },
  suggestionText: { color: '#fff' },
  gridItemAlias: { color: LIGHT_GOLD, textAlign: 'center', fontSize: 11, fontStyle: 'italic', marginTop: 2 },
  stepperContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#333', borderRadius: 8, borderWidth: 1, borderColor: '#444', overflow: 'hidden' },
  stepperBtn: { paddingHorizontal: 15, paddingVertical: 8, backgroundColor: '#444' },
  stepperBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  stepperValue: { color: '#fff', fontSize: 16, paddingHorizontal: 15, fontWeight: 'bold', minWidth: 40, textAlign: 'center' },
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
