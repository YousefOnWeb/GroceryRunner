import { Text, TextInput } from '@/components/Themed';
import { api } from '@/db/api';
import React, { useEffect, useState } from 'react';
import { Alert, I18nManager, Keyboard, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import * as Contacts from 'expo-contacts';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSettings } from '@/utils/settings';
import CreditLogModal from './CreditLogModal';
import { db } from '@/db';
import { persons } from '@/db/schema';
import { useTranslation } from '@/utils/i18n';
import { ACCENT_GOLD } from '@/constants/Colors';
import SettleUpModal from './SettleUpModal';

interface PersonModalProps {
  visible: boolean;
  mode: 'create' | 'edit';
  /** For edit mode */
  personId?: string;
  initialName?: string;
  initialPlace?: string | null;
  initialPrimaryPhone?: string | null;
  initialAliases?: string[];
  initialBalance?: number;
  onCancel: () => void;
  onDone: (personId?: string) => void;
}

export default function PersonModal({
  visible,
  mode,
  personId,
  initialName = '',
  initialPlace = '',
  initialPrimaryPhone = '',
  initialAliases = [],
  initialBalance = 0,
  onCancel,
  onDone,
}: PersonModalProps) {
  const [name, setName] = useState(initialName);
  const [place, setPlace] = useState(initialPlace || '');
  const [primaryPhone, setPrimaryPhone] = useState(initialPrimaryPhone || '');
  const [aliases, setAliases] = useState<string[]>(initialAliases);
  const [newAlias, setNewAlias] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState<string[]>([]);
  const [showPlaceSuggestions, setShowPlaceSuggestions] = useState(false);

  // Credit adjustment (edit mode only)
  const [adjustType, setAdjustType] = useState<'increase' | 'decrease' | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [logVisible, setLogVisible] = useState(false);
  const [settleVisible, setSettleVisible] = useState(false);
  const { settings } = useSettings();
  const { t } = useTranslation();

  const initialAliasesKey = JSON.stringify(initialAliases);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setPlace(initialPlace || '');
      setPrimaryPhone(initialPrimaryPhone || '');
      setAliases([...initialAliases]);
      setNewAlias('');
      setAdjustType(null);
      setAdjustAmount('');
      setAdjustNote('');
      loadPlaceSuggestions();
    }
  }, [visible, initialName, initialPlace, initialPrimaryPhone, initialAliasesKey, initialBalance]);

  const loadPlaceSuggestions = async () => {
    try {
      const places = await api.getDistinctPlaces();
      setPlaceSuggestions(places);
    } catch (e) {
      console.error('Error loading places:', e);
    }
  };

  const handlePickContact = async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('common.error'), t('modals.permissionDenied'));
        return;
      }
      
      const contact = await Contacts.presentContactPickerAsync();
      if (contact && contact.phoneNumbers && contact.phoneNumbers.length > 0) {
        setPrimaryPhone(contact.phoneNumbers[0].number || '');
      }
    } catch (err) {
      console.warn('Failed to pick contact', err);
    }
  };

  const addAlias = () => {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    if (aliases.some(a => a.toLowerCase() === trimmed.toLowerCase())) {
      Alert.alert(t('modals.duplicate'), t('modals.nicknameExists'));
      return;
    }
    if (trimmed.toLowerCase() === name.toLowerCase()) {
      Alert.alert(t('modals.duplicate'), t('modals.nicknameSame'));
      return;
    }
    setAliases(prev => [...prev, trimmed]);
    setNewAlias('');
  };

  const removeAlias = (index: number) => {
    setAliases(prev => prev.filter((_, i) => i !== index));
  };

  const filteredPlaces = place.trim()
    ? placeSuggestions.filter(p => p.toLowerCase().includes(place.toLowerCase()) && p.toLowerCase() !== place.toLowerCase())
    : [];

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert(t('common.error'), t('modals.nameRequired'));
      return;
    }

    try {
      if (mode === 'create') {
        const result = await api.addPerson(name, place || null, primaryPhone || null, aliases);
        Alert.alert(t('common.success'), t('modals.personAdded', { name }));
        onDone(result[0].id);
      } else if (mode === 'edit' && personId) {
        await api.updatePerson(personId, {
          name: name.trim(),
          typicalPlace: place || null,
          primaryPhone: primaryPhone || null,
          aliases,
        });

        // Apply credit adjustment if set
        if (adjustType && adjustAmount) {
          const amount = parseFloat(adjustAmount);
          if (!isNaN(amount) && amount > 0) {
            if (!adjustNote.trim()) {
              Alert.alert(t('modals.noteRequired'), t('modals.creditNoteRequired'));
              return;
            }
            const finalAmount = adjustType === 'increase' ? amount : -amount;
            await api.changeBalance(personId, finalAmount, adjustNote.trim());
          }
        }

        Alert.alert(t('common.success'), t('modals.personUpdated', { name }));
      }
      onDone();
    } catch (e) {
      console.error(e);
      Alert.alert(t('common.error'), t('modals.personSaveFailed'));
    }
  };

  const handleDelete = () => {
    if (!personId) return;
    Alert.alert(
      t('modals.deletePerson'),
      t('modals.deletePersonConfirm', { name: initialName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deletePerson(personId);
              onDone();
            } catch (e) {
              console.error(e);
              Alert.alert(t('common.error'), t('modals.deletePersonFailed'));
            }
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <ScrollView style={styles.dialog} contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, settings.compactMode && styles.titleCompact]}>
            {mode === 'create' ? t('modals.addNewPerson') : t('modals.editPerson', { name: initialName })}
          </Text>

          {/* Name */}
          <Text style={styles.label}>{t('modals.nameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('modals.namePlaceholder')}
            placeholderTextColor="#888"
          />

          {/* Typical Place */}
          <Text style={styles.label}>{t('modals.placeLabel')}</Text>
          <TextInput
            style={styles.input}
            value={place}
            onChangeText={(text) => {
              setPlace(text);
              setShowPlaceSuggestions(text.length > 0);
            }}
            onBlur={() => {
              setTimeout(() => {
                setShowPlaceSuggestions(false);
              }, 150);
            }}
            placeholder={t('modals.placePlaceholder')}
            placeholderTextColor="#888"
          />
          {showPlaceSuggestions && filteredPlaces.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {filteredPlaces.map((suggestion, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.suggestionItem}
                  onPress={() => {
                    setPlace(suggestion);
                    setShowPlaceSuggestions(false);
                  }}>
                  <Text style={styles.suggestionText}>{suggestion}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Primary Phone */}
          <Text style={styles.label}>{t('modals.phoneLabel') || 'Primary Phone Number (Optional)'}</Text>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 5 }]}
              value={primaryPhone}
              onChangeText={setPrimaryPhone}
              placeholder={t('modals.phonePlaceholder') || 'e.g. +20123456789'}
              placeholderTextColor="#888"
              keyboardType="phone-pad"
            />
            <TouchableOpacity onPress={handlePickContact} style={styles.pickContactBtn}>
              <FontAwesome name="address-book" size={24} color="#1a1a1a" />
            </TouchableOpacity>
          </View>

          {/* Nicknames/Aliases */}
          <Text style={styles.label}>{t('modals.aliasesLabelPerson')}</Text>
          <Text style={styles.hint}>
            {t('modals.aliasesHintPerson')}
          </Text>
          {aliases.map((alias, idx) => (
            <View key={idx} style={styles.aliasRow}>
              <Text style={styles.aliasText}>{alias}</Text>
              <TouchableOpacity onPress={() => removeAlias(idx)} style={styles.removeAliasBtn}>
                <FontAwesome name="times-circle" size={20} color="#ff4444" />
              </TouchableOpacity>
            </View>
          ))}
          <View style={styles.addAliasRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={newAlias}
              onChangeText={setNewAlias}
              placeholder={t('modals.addAliasPlaceholderPerson')}
              placeholderTextColor="#888"
              onSubmitEditing={addAlias}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.addAliasBtn, !newAlias.trim() && { opacity: 0.4 }]}
              onPress={addAlias}
              disabled={!newAlias.trim()}>
              <FontAwesome name="plus" size={16} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Credit Adjustment (edit mode only) */}
          {mode === 'edit' && (
            <>
              <View style={styles.divider} />
              <Text style={styles.label}>{t('modals.adjustCredit')}</Text>
              <Text style={styles.hint}>
                {initialBalance === 0 ? t('modals.currentBalance', { balance: t('common.currencyFormat', { amount: '0.00' }) }) : (initialBalance < 0 ? t('people.yourMoneyWithThem', { amount: Math.abs(initialBalance).toFixed(2) }) : t('people.theirMoneyWithYou', { amount: Math.abs(initialBalance).toFixed(2) }))}
              </Text>
              <View style={styles.adjustRow}>
                <TouchableOpacity
                  style={[styles.adjustTypeBtn, adjustType === 'increase' && styles.adjustTypeBtnActive]}
                  onPress={() => setAdjustType(adjustType === 'increase' ? null : 'increase')}>
                  <FontAwesome name="plus" size={14} color={adjustType === 'increase' ? '#fff' : '#00C851'} />
                  <Text style={[styles.adjustTypeText, adjustType === 'increase' && { color: '#fff' }]}>{t('modals.increase')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.adjustTypeBtn, styles.adjustTypeBtnDanger, adjustType === 'decrease' && styles.adjustTypeBtnDangerActive]}
                  onPress={() => setAdjustType(adjustType === 'decrease' ? null : 'decrease')}>
                  <FontAwesome name="minus" size={14} color={adjustType === 'decrease' ? '#fff' : '#ff4444'} />
                  <Text style={[styles.adjustTypeText, { color: adjustType === 'decrease' ? '#fff' : '#ff4444' }]}>{t('modals.decrease')}</Text>
                </TouchableOpacity>
              </View>
              {adjustType && (
                <>
                  <TextInput
                    style={[styles.input, settings.compactMode && styles.inputCompact]}
                    value={adjustAmount}
                    onChangeText={setAdjustAmount}
                    placeholder={t('modals.amountPlaceholder')}
                    placeholderTextColor="#888"
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={[styles.input, settings.compactMode && styles.inputCompact]}
                    value={adjustNote}
                    onChangeText={setAdjustNote}
                    placeholder={t('modals.notePlaceholder')}
                    placeholderTextColor="#888"
                  />
                </>
              )}
              <View style={{ flexDirection: 'column', gap: 10, marginTop: 10 }}>
                <TouchableOpacity 
                  style={[styles.logLinkBtn, settings.compactMode && styles.logLinkBtnCompact]} 
                  onPress={() => setLogVisible(true)}
                >
                  <FontAwesome name="history" size={settings.compactMode ? 14 : 16} color={ACCENT_GOLD} />
                  <Text style={[styles.logLinkText, settings.compactMode && styles.textSmall]}>{t('modals.viewCreditLog')}</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.logLinkBtn, { backgroundColor: 'rgba(0, 200, 81, 0.1)', borderColor: 'rgba(0, 200, 81, 0.3)' }, settings.compactMode && styles.logLinkBtnCompact]} 
                  onPress={() => setSettleVisible(true)}
                >
                  <FontAwesome name="money" size={settings.compactMode ? 14 : 16} color="#00C851" />
                  <Text style={[styles.logLinkText, { color: '#00C851' }, settings.compactMode && styles.textSmall]}>
                    {t('run.receivePaymentTitle')}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Action Buttons */}
          <View style={[styles.buttonRow, settings.compactMode && styles.buttonRowCompact]}>
            {mode === 'edit' && (
              <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                <FontAwesome name="trash" size={settings.compactMode ? 14 : 18} color="#ff4444" />
                <Text style={[styles.deleteBtnText, settings.compactMode && styles.textSmall]}>{t('common.delete')}</Text>
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={[styles.cancelBtnText, settings.compactMode && styles.textSmall]}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, !name.trim() && { opacity: 0.5 }, settings.compactMode && styles.submitBtnCompact]}
              onPress={handleSubmit}
              disabled={!name.trim()}>
              <Text style={[styles.submitBtnText, settings.compactMode && styles.textSmall]}>{mode === 'create' ? t('modals.addPersonBtn') : t('modals.saveChanges')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      <CreditLogModal 
        visible={logVisible} 
        personId={personId || ''} 
        personName={name} 
        onClose={() => setLogVisible(false)} 
      />
      <SettleUpModal
        visible={settleVisible}
        personId={personId || ''}
        personName={name}
        currentBalance={initialBalance}
        onClose={() => setSettleVisible(false)}
        onSubmit={async (amount, note) => {
          if (!personId) return;
          try {
            await api.receivePayment(personId, amount, note);
            setSettleVisible(false);
            Alert.alert(t('common.success'), 'Payment received successfully.');
            onDone();
          } catch (e) {
            console.error(e);
            Alert.alert(t('common.error'), 'Failed to process payment.');
          }
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialog: {
    backgroundColor: '#222',
    width: '100%',
    borderRadius: 12,
    padding: 20,
    elevation: 5,
    maxHeight: '90%',
  },
  dialogContent: {
    flexGrow: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 5,
    marginTop: 10,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  input: {
    backgroundColor: '#333',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#444',
    marginBottom: 5,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  suggestionsContainer: {
    backgroundColor: '#333',
    borderRadius: 6,
    marginTop: 2,
    marginBottom: 5,
    maxHeight: 120,
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#444',
  },
  suggestionText: {
    color: ACCENT_GOLD,
    fontSize: 14,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  aliasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#333',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 5,
  },
  aliasText: {
    color: '#fff',
    fontSize: 15,
  },
  removeAliasBtn: {
    padding: 4,
  },
  addAliasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
  },
  addAliasBtn: {
    backgroundColor: ACCENT_GOLD,
    padding: 12,
    borderRadius: 8,
  },
  pickContactBtn: {
    backgroundColor: ACCENT_GOLD,
    height: 48,
    paddingHorizontal: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    marginBottom: 5,
  },
  divider: {
    height: 1,
    backgroundColor: '#444',
    marginVertical: 15,
  },
  adjustRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  adjustTypeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#00C851',
  },
  adjustTypeBtnActive: {
    backgroundColor: '#00C851',
  },
  adjustTypeBtnDanger: {
    borderColor: '#ff4444',
  },
  adjustTypeBtnDangerActive: {
    backgroundColor: '#ff4444',
  },
  adjustTypeText: {
    color: '#00C851',
    fontWeight: '600',
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  deleteBtnText: {
    color: '#ff4444',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
  },
  cancelBtnText: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: '#28a745',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 15,
    padding: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  logLinkBtnCompact: {
    marginTop: 10,
    padding: 8,
  },
  logLinkText: {
    color: ACCENT_GOLD,
    fontWeight: '600',
  },
  titleCompact: { fontSize: 18, marginBottom: 12 },
  inputCompact: { padding: 8, fontSize: 14, marginBottom: 4 },
  buttonRowCompact: { marginTop: 10 },
  submitBtnCompact: { paddingVertical: 8, paddingHorizontal: 15 },
  textSmall: { fontSize: 14 },
  textExtraSmall: { fontSize: 11 },
});
