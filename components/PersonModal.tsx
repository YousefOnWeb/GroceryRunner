import { Text, TextInput } from '@/components/Themed';
import { api } from '@/db/api';
import React, { useEffect, useState } from 'react';
import { Alert, I18nManager, Keyboard, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSettings } from '@/utils/settings';
import CreditLogModal from './CreditLogModal';
import SmartTextInput from './SmartTextInput';
import { COMMON_NAMES_CORPUS } from '@/utils/textMatching';
import { db } from '@/db';
import { persons } from '@/db/schema';
import { useTranslation } from '@/utils/i18n';
import { ACCENT_GOLD } from '@/constants/Colors';

interface PersonModalProps {
  visible: boolean;
  mode: 'create' | 'edit';
  /** For edit mode */
  personId?: string;
  initialName?: string;
  initialPlace?: string | null;
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
  initialAliases = [],
  initialBalance = 0,
  onCancel,
  onDone,
}: PersonModalProps) {
  const [name, setName] = useState(initialName);
  const [place, setPlace] = useState(initialPlace || '');
  const [aliases, setAliases] = useState<string[]>(initialAliases);
  const [newAlias, setNewAlias] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState<string[]>([]);
  const [showPlaceSuggestions, setShowPlaceSuggestions] = useState(false);

  // Credit adjustment (edit mode only)
  const [adjustType, setAdjustType] = useState<'increase' | 'decrease' | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [logVisible, setLogVisible] = useState(false);
  const [activeFocus, setActiveFocus] = useState<string | null>(null);
  const [namesCorpus, setNamesCorpus] = useState<string[]>(COMMON_NAMES_CORPUS);
  const { settings } = useSettings();
  const { t } = useTranslation();

  const initialAliasesKey = JSON.stringify(initialAliases);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setPlace(initialPlace || '');
      setAliases([...initialAliases]);
      setNewAlias('');
      setAdjustType(null);
      setAdjustAmount('');
      setAdjustNote('');
      loadPlaceSuggestions();
      loadCorpus();
    }
  }, [visible, initialName, initialPlace, initialAliasesKey]);

  const loadCorpus = async () => {
    try {
      const dbPersons = await db.select({ name: persons.name }).from(persons);
      const names = dbPersons.map(p => p.name);
      setNamesCorpus([...new Set([...names, ...COMMON_NAMES_CORPUS])]);
    } catch (e) {
      console.error(e);
    }
  };

  const loadPlaceSuggestions = async () => {
    try {
      const places = await api.getDistinctPlaces();
      setPlaceSuggestions(places);
    } catch (e) {
      console.error('Error loading places:', e);
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
        const result = await api.addPerson(name, place || null, aliases);
        Alert.alert(t('common.success'), t('modals.personAdded', { name }));
        onDone(result[0].id);
      } else if (mode === 'edit' && personId) {
        await api.updatePerson(personId, {
          name: name.trim(),
          typicalPlace: place || null,
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

          {activeFocus && (
            <TouchableOpacity 
              style={[styles.exitSearchBtn, settings.compactMode && styles.exitSearchBtnCompact]} 
              onPress={() => {
                setActiveFocus(null);
                Keyboard.dismiss();
              }}
            >
              <FontAwesome name={I18nManager.isRTL ? "chevron-right" : "chevron-left"} size={settings.compactMode ? 12 : 14} color={ACCENT_GOLD} />
              <Text style={[styles.exitSearchText, settings.compactMode && styles.textSmall]}>{t('common.exitFocusMode')}</Text>
            </TouchableOpacity>
          )}

          {/* Name */}
          {(!activeFocus || activeFocus === 'name') && (
            <>
              <Text style={styles.label}>{t('modals.nameLabel')}</Text>
              <SmartTextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                onFocus={() => setActiveFocus('name')}
                onBlur={() => { if (!name) setActiveFocus(null); }}
                placeholder={t('modals.namePlaceholder')}
                placeholderTextColor="#888"
                corpus={namesCorpus}
                compactMode={settings.compactMode}
              />
            </>
          )}

          {/* Typical Place */}
          {(!activeFocus || activeFocus === 'place') && (
            <>
              <Text style={styles.label}>{t('modals.placeLabel')}</Text>
              <TextInput
                style={styles.input}
                value={place}
                onChangeText={(text) => {
                  setPlace(text);
                  setShowPlaceSuggestions(text.length > 0);
                }}
                onFocus={() => {
                  setActiveFocus('place');
                  if (place.length > 0) setShowPlaceSuggestions(true);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setShowPlaceSuggestions(false);
                    if (!place) setActiveFocus(null);
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
                        setActiveFocus(null);
                      }}>
                      <Text style={styles.suggestionText}>{suggestion}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          {/* Nicknames/Aliases */}
          {(!activeFocus || activeFocus === 'aliases') && (
            <>
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
                <SmartTextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={newAlias}
                  onChangeText={setNewAlias}
                  onFocus={() => setActiveFocus('aliases')}
                  onBlur={() => { if (!newAlias) setActiveFocus(null); }}
                  placeholder={t('modals.addAliasPlaceholderPerson')}
                  placeholderTextColor="#888"
                  onSubmitEditing={addAlias}
                  returnKeyType="done"
                  corpus={namesCorpus}
                  compactMode={settings.compactMode}
                />
                <TouchableOpacity
                  style={[styles.addAliasBtn, !newAlias.trim() && { opacity: 0.4 }]}
                  onPress={addAlias}
                  disabled={!newAlias.trim()}>
                  <FontAwesome name="plus" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Credit Adjustment (edit mode only) */}
          {!activeFocus && mode === 'edit' && (
            <>
              <View style={styles.divider} />
              <Text style={styles.label}>{t('modals.adjustCredit')}</Text>
              <Text style={styles.hint}>
                {t('modals.currentBalance', { balance: initialBalance.toFixed(2) })}
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
              
              <TouchableOpacity 
                style={[styles.logLinkBtn, settings.compactMode && styles.logLinkBtnCompact]} 
                onPress={() => setLogVisible(true)}
              >
                <FontAwesome name="history" size={settings.compactMode ? 14 : 16} color={ACCENT_GOLD} />
                <Text style={[styles.logLinkText, settings.compactMode && styles.textSmall]}>{t('modals.viewCreditLog')}</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Action Buttons */}
          {!activeFocus && (
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
          )}
        </ScrollView>
      </View>

      <CreditLogModal 
        visible={logVisible} 
        personId={personId || ''} 
        personName={name} 
        onClose={() => setLogVisible(false)} 
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
  exitSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#444',
  },
  exitSearchBtnCompact: {
    paddingVertical: 5,
    marginBottom: 5,
  },
  exitSearchText: {
    color: ACCENT_GOLD,
    fontWeight: 'bold',
  },
});
