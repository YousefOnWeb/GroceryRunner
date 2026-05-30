import { Text, TextInput } from '@/components/Themed';
import { api } from '@/db/api';
import React, { useEffect, useState } from 'react';
import { Alert, I18nManager, Keyboard, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import DropdownSelect from './DropdownSelect';
import { useSettings } from '@/utils/settings';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import SmartTextInput from './SmartTextInput';
import { COMMON_GROCERY_CORPUS } from '@/utils/textMatching';
import { db } from '@/db';
import { items } from '@/db/schema';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useTranslation } from '@/utils/i18n';
import { ACCENT_GOLD } from '@/constants/Colors';

const EMPTY_ARRAY: any[] = [];

interface CreateItemModalProps {
  visible: boolean;
  title?: string;
  submitLabel?: string;
  initialName?: string;
  initialPrice?: number | null;
  initialSource?: string | null;
  initialTiming?: 'Fresh' | 'Anytime';
  initialAliases?: string[];
  onCancel: () => void;
  onSubmit: (name: string, defaultPrice: number | null, source: string | null, timing: 'Fresh' | 'Anytime', isCorrection: boolean, aliases: string[]) => void;
}

export default function CreateItemModal({
  visible,
  title = 'Create New Item',
  submitLabel = 'Create Item',
  initialName = '',
  initialPrice = null,
  initialSource = '',
  initialTiming = 'Fresh',
  initialAliases = EMPTY_ARRAY,
  onCancel,
  onSubmit,
}: CreateItemModalProps) {
  const [name, setName] = useState(initialName);
  const [priceStr, setPriceStr] = useState(initialPrice ? String(initialPrice) : '');
  const [source, setSource] = useState(initialSource || '');
  const [sourceSearch, setSourceSearch] = useState('');
  const [showSourceSuggestions, setShowSourceSuggestions] = useState(false);
  const [distinctSources, setDistinctSources] = useState<string[]>([]);
  const [timing, setTiming] = useState<'Fresh' | 'Anytime'>(initialTiming);
  const [aliases, setAliases] = useState<string[]>(initialAliases);
  const [newAlias, setNewAlias] = useState('');
  const [isCorrection, setIsCorrection] = useState(false);
  const [activeFocus, setActiveFocus] = useState<string | null>(null);
  const [itemCorpus, setItemCorpus] = useState<string[]>(COMMON_GROCERY_CORPUS);
  const { settings } = useSettings();
  const { t } = useTranslation();

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setPriceStr(initialPrice ? String(initialPrice) : '');
      setSource(initialSource || '');
      setSourceSearch('');
      setShowSourceSuggestions(false);
      loadDistinctSources();
      setTiming(initialTiming);
      setAliases([...initialAliases]);
      setNewAlias('');
      setIsCorrection(false);
      loadCorpus();
    }
  }, [visible, initialName, initialPrice, initialSource, initialTiming, initialAliases]);

  const loadCorpus = async () => {
    try {
      const dbItems = await db.select({ name: items.name }).from(items);
      const names = dbItems.map(i => i.name);
      setItemCorpus([...new Set([...names, ...COMMON_GROCERY_CORPUS])]);
    } catch (e) {
      console.error(e);
    }
  };

  const loadDistinctSources = async () => {
    try {
      const sources = await api.getDistinctSources();
      setDistinctSources(sources);
    } catch (error) {
      console.error('Error loading sources:', error);
    }
  };

  const filteredSources = sourceSearch.trim()
    ? distinctSources.filter(s => s.toLowerCase().includes(sourceSearch.toLowerCase()))
    : [];

  const handleSourceSelect = (selected: string) => {
    setSource(selected);
    setSourceSearch('');
    setShowSourceSuggestions(false);
  };

  const addAlias = () => {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    if (aliases.some(a => a.toLowerCase() === trimmed.toLowerCase())) return;
    if (trimmed.toLowerCase() === name.toLowerCase()) return;
    setAliases(prev => [...prev, trimmed]);
    setNewAlias('');
  };

  const removeAlias = (index: number) => {
    setAliases(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    const price = parseFloat(priceStr);
    const finalSource = (sourceSearch.trim() || source.trim()) || null;
    onSubmit(
      name,
      isNaN(price) ? null : price,
      finalSource,
      timing,
      isCorrection,
      aliases
    );
  };

  const showPriceHelp = () => {
    Alert.alert(
      t('modals.priceUpdateHelpTitle'),
      t('modals.priceUpdateHelpMsg')
    );
  };

  const isEditMode = title.toLowerCase().includes('edit') || title.includes('تعديل');

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <ScrollView style={styles.dialog} contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, settings.compactMode && styles.titleCompact]}>{title}</Text>

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

          {(!activeFocus || activeFocus === 'name') && (
            <>
              <Text style={[styles.label, settings.compactMode && styles.textExtraSmall]}>{t('modals.itemNameLabel')}</Text>
              <SmartTextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                onFocus={() => setActiveFocus('name')}
                onBlur={() => { if (!name) setActiveFocus(null); }}
                placeholder={t('modals.itemNamePlaceholder')}
                placeholderTextColor="#888"
                autoFocus={!isEditMode}
                corpus={itemCorpus}
                compactMode={settings.compactMode}
              />
            </>
          )}

          {!activeFocus && (
            <>
              <Text style={[styles.label, settings.compactMode && styles.textExtraSmall]}>{t('modals.defaultPriceLabel')}</Text>
              <TextInput
                style={styles.input}
                value={priceStr}
                onChangeText={setPriceStr}
                placeholder="0.00"
                placeholderTextColor="#888"
                keyboardType="numeric"
              />
            </>
          )}

          {(!activeFocus || activeFocus === 'source') && (
            <>
              <Text style={[styles.label, settings.compactMode && styles.textExtraSmall]}>{t('modals.usualSourceLabel')}</Text>
              <TextInput
                style={styles.input}
                value={sourceSearch || source}
                onChangeText={(text) => {
                  setSourceSearch(text);
                  setShowSourceSuggestions(text.length > 0);
                }}
                onFocus={() => {
                  setActiveFocus('source');
                  if (sourceSearch.length > 0) setShowSourceSuggestions(true);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setShowSourceSuggestions(false);
                    if (!sourceSearch) setActiveFocus(null);
                  }, 150);
                }}
                placeholder={t('modals.usualSourcePlaceholder')}
                placeholderTextColor="#888"
              />
              
              {showSourceSuggestions && filteredSources.length > 0 && (
                <View style={styles.suggestionsContainer}>
                  {filteredSources.map((suggestion, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.suggestionItem}
                      onPress={() => {
                        handleSourceSelect(suggestion);
                        setActiveFocus(null);
                      }}>
                      <Text style={styles.suggestionText}>{suggestion}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          {(!activeFocus || activeFocus === 'aliases') && (
            <>
              <Text style={[styles.label, settings.compactMode && styles.textExtraSmall]}>{t('modals.aliasesLabel')}</Text>
              <Text style={styles.hint}>{t('modals.aliasesHint')}</Text>
              
              <View style={styles.aliasList}>
                {aliases.map((alias, idx) => (
                  <View key={idx} style={styles.aliasRow}>
                    <Text style={styles.aliasText}>{alias}</Text>
                    <TouchableOpacity onPress={() => removeAlias(idx)} style={styles.removeAliasBtn}>
                      <FontAwesome name="times-circle" size={18} color="#ff4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>

              <View style={styles.addAliasRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={newAlias}
                  onChangeText={setNewAlias}
                  onFocus={() => setActiveFocus('aliases')}
                  onBlur={() => { if (!newAlias) setActiveFocus(null); }}
                  placeholder={t('modals.addAliasPlaceholder')}
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
            </>
          )}

          {!activeFocus && (
            <>
              <Text style={[styles.label, settings.compactMode && styles.textExtraSmall]}>{t('modals.timingLabel')}</Text>
              <View style={[styles.dropdownContainer, settings.compactMode && styles.dropdownContainerCompact]}>
                <DropdownSelect
                  value={timing}
                  options={['Fresh', 'Anytime']}
                  onSelect={(val) => setTiming(val as 'Fresh' | 'Anytime')}
                />
              </View>

              {isEditMode && initialPrice !== null && (
                <View style={[styles.correctionSection, settings.compactMode && styles.correctionSectionCompact]}>
                  <View style={styles.correctionHeader}>
                    <Text style={[styles.label, { marginTop: 0 }, settings.compactMode && styles.textExtraSmall]}>{t('modals.updateModeLabel')}</Text>
                    <TouchableOpacity onPress={showPriceHelp} style={styles.helpBtn}>
                      <FontAwesome name="question-circle" size={settings.compactMode ? 14 : 18} color={ACCENT_GOLD} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.modeToggleRow}>
                    <TouchableOpacity 
                      style={[
                        styles.modeBtn, 
                        !isCorrection && styles.modeBtnActive,
                        settings.compactMode && styles.modeBtnCompact
                      ]} 
                      onPress={() => setIsCorrection(false)}
                    >
                      <Text style={[styles.modeBtnText, !isCorrection && styles.modeBtnTextActive, settings.compactMode && styles.textExtraSmall]}>{t('modals.marketChange')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[
                        styles.modeBtn, 
                        isCorrection && styles.modeBtnActiveCorrection,
                        settings.compactMode && styles.modeBtnCompact
                      ]} 
                      onPress={() => setIsCorrection(true)}
                    >
                      <Text style={[styles.modeBtnText, isCorrection && styles.modeBtnTextActive, settings.compactMode && styles.textExtraSmall]}>{t('modals.correction')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={[styles.buttonRow, settings.compactMode && styles.buttonRowCompact]}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
                  <Text style={[styles.cancelBtnText, settings.compactMode && styles.textSmall]}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, !name.trim() && { opacity: 0.5 }, settings.compactMode && styles.submitBtnCompact]}
                  onPress={handleSubmit}
                  disabled={!name.trim()}>
                  <Text style={[styles.submitBtnText, settings.compactMode && styles.textSmall]}>{submitLabel}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </View>
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
  titleCompact: { fontSize: 18, marginBottom: 10 },
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
    marginTop: 5,
    maxHeight: 150,
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
  dropdownContainer: {
    marginBottom: 10,
    zIndex: 10,
  },
  aliasList: {
    marginBottom: 5,
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
    marginBottom: 10,
  },
  addAliasBtn: {
    backgroundColor: ACCENT_GOLD,
    padding: 12,
    borderRadius: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
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
  correctionSection: {
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  correctionSectionCompact: {
    padding: 8,
    marginTop: 5,
  },
  correctionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  helpBtn: {
    padding: 2,
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
  },
  modeBtnCompact: {
    paddingVertical: 6,
  },
  modeBtnActive: {
    backgroundColor: '#333',
    borderColor: ACCENT_GOLD,
  },
  modeBtnActiveCorrection: {
    backgroundColor: '#333',
    borderColor: '#ff9800',
  },
  modeBtnText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  modeBtnTextActive: {
    color: '#fff',
  },
  dropdownContainerCompact: {
    marginBottom: 5,
  },
  buttonRowCompact: {
    marginTop: 10,
  },
  submitBtnCompact: {
    paddingVertical: 8,
    paddingHorizontal: 15,
  },
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
