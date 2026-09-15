import {
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  DEFAULT_AI_MODELS,
  DEFAULT_BASE_URLS,
  TRAINING_LEVEL_LABELS,
  TRAINING_LEVELS,
  type AiProvider,
} from '@lift/shared';
import { useCallback, useEffect, useState } from 'react';

import { Card, Divider, PromptModal, Reveal } from '@/components/ui';
import { requireAiConfig, testConnection } from '@/features/ai/client';
import { AiError } from '@/features/ai/errors';
import { deleteApiKey, maskApiKey, readApiKey, writeApiKey } from '@/features/ai/key-storage';
import { Footnote, SettingsPage, settingsStyles } from '@/features/settings/page';
import { SettingAction, SettingChoice, SettingToggle, SettingValue } from '@/features/settings/rows';
import { showAlert, showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme';

/** Which of the three text fields is open, if any. */
type Editing = 'key' | 'model' | 'baseUrl' | null;

/**
 * Keyboard behaviour for a field holding an identifier rather than a sentence.
 *
 * Every one of these three is a string a phone will capitalise and autocorrect
 * into something that no longer works, and the failure is invisible: a key with
 * a capitalised first character is rejected as a bad key, not as a typo.
 */
const RAW_INPUT = {
  autoCapitalize: 'none',
  autoCorrect: false,
  spellCheck: false,
  autoComplete: 'off',
} as const;

/**
 * The one screen in the app that turns on a network call to somebody else.
 *
 * It is written to be read before it is used, which is why the footnotes are
 * long and say the unwelcome parts out loud: what leaves the device, where it
 * goes, and who pays for it. The whole app's claim is that nothing goes
 * anywhere unless it is asked to, and a feature that quietly weakens that claim
 * would be worth less than the feature is worth.
 *
 * The key is not a setting. Settings are a JSON blob in an ordinary SQLite row
 * that lands in backups; a credential belongs in the keychain, which is what
 * `features/ai/key-storage` is for. That split is the reason this screen holds
 * its own piece of state instead of reading everything from the store.
 */
export default function AiSettingsScreen() {
  const settings = useSettings();
  const update = useSettings((state) => state.update);

  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [testing, setTesting] = useState(false);

  const provider = settings.aiProvider;

  // Re-read on every provider change: keys are stored one per provider, so
  // switching from Claude to a local model must not report the Claude key as
  // present against an endpoint that has never seen it.
  useEffect(() => {
    let live = true;
    void readApiKey(provider).then((key) => {
      if (live) setStoredKey(key);
    });
    return () => {
      live = false;
    };
  }, [provider]);

  const saveKey = useCallback(
    async (value: string) => {
      const ok = await writeApiKey(provider, value);
      if (!ok) {
        // Worth interrupting for. Silently accepting a key that will not
        // survive a restart is how somebody concludes the feature is broken
        // rather than that their browser is blocking storage.
        await showAlert(
          'Could not store the key',
          'This device would not let the app save to secure storage. The key has not been kept.',
        );
        return;
      }
      setStoredKey(await readApiKey(provider));
    },
    [provider],
  );

  const clearKey = useCallback(async () => {
    const confirmed = await showConfirm({
      title: 'Remove the API key?',
      message: `The ${AI_PROVIDER_LABELS[provider]} key is deleted from this device. Conversations you have already had are kept.`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;

    await deleteApiKey(provider);
    setStoredKey(null);
  }, [provider]);

  const runTest = useCallback(async () => {
    setTesting(true);
    try {
      await testConnection(await requireAiConfig());
      await showAlert('Connected', 'The key works and the model answered.');
    } catch (cause) {
      const error = cause instanceof AiError ? cause : null;
      await showAlert(
        'That did not work',
        error ? [error.message, error.detail].filter(Boolean).join('\n\n') : String(cause),
      );
    } finally {
      setTesting(false);
    }
  }, []);

  const prompt = promptFor(editing, settings.aiModel, settings.aiBaseUrl, provider);

  return (
    <SettingsPage title="AI coach">
      <Reveal>
        <Card padded={false} style={settingsStyles.first}>
          <SettingToggle
            icon="sparkles-outline"
            label="AI coach"
            description="Ask a model about your training, from inside the app."
            value={settings.aiEnabled}
            onChange={(value) => update('aiEnabled', value)}
          />
        </Card>
        <Footnote>
          Off, nothing here contacts anything and every screen works exactly as it did. On, the app
          sends your training log to the provider you choose below, using your own API key, and
          nothing passes through a Lift server on the way. You are billed by them, not by this app.
        </Footnote>

        <Card padded={false} style={settingsStyles.sectionStacked}>
          {/*
           * Not gated on the switch above, and neither are the key or the model.
           *
           * The switch controls whether anything is ever sent; this card is the
           * setting up, and setting up before turning on is the order most
           * people do it in. Gating the provider while leaving the key field
           * live was worse than either: it invited somebody to paste a key
           * without being able to say which service it belonged to.
           */}
          <SettingChoice
            icon="cube-outline"
            label="Provider"
            description="Where requests go, and whose key pays for them."
            options={AI_PROVIDERS.map((value) => ({
              value,
              label: AI_PROVIDER_LABELS[value],
            }))}
            value={provider}
            onChange={(value: AiProvider) => update('aiProvider', value)}
          />
          <Divider inset={spacing.lg} />
          <SettingValue
            icon="key-outline"
            label="API key"
            value={storedKey ? maskApiKey(storedKey) : 'Not set'}
            hint="Opens a field to paste your API key."
            onPress={() => setEditing('key')}
          />
          <Divider inset={spacing.lg} />
          <SettingValue
            icon="chatbox-outline"
            label="Model"
            value={settings.aiModel.trim() || DEFAULT_AI_MODELS[provider]}
            hint="Opens a field to name the model to use."
            onPress={() => setEditing('model')}
          />
          {/*
           * Anthropic has one address. Offering a field to change it would be
           * offering a way to break the only path that needs no configuration.
           */}
          {provider === 'openai-compatible' && (
            <>
              <Divider inset={spacing.lg} />
              <SettingValue
                icon="link-outline"
                label="Base URL"
                value={settings.aiBaseUrl.trim() || DEFAULT_BASE_URLS[provider]}
                hint="Opens a field to point the app at a different server."
                onPress={() => setEditing('baseUrl')}
              />
            </>
          )}
          {storedKey && (
            <>
              <Divider inset={spacing.lg} />
              <SettingAction
                icon="pulse-outline"
                label={testing ? 'Testing…' : 'Test connection'}
                description="Sends a two-word request, so a wrong key is found here rather than halfway through a review."
                disabled={testing || !settings.aiEnabled}
                onPress={() => void runTest()}
              />
              <Divider inset={spacing.lg} />
              <SettingAction
                icon="trash-outline"
                label="Remove API key"
                tone="danger"
                onPress={() => void clearKey()}
              />
            </>
          )}
        </Card>
        <Footnote>
          Set this up whenever you like: nothing is sent until the switch above is on. The key is
          held in this device&apos;s keychain, never in your settings and never in a backup, and it
          goes only to the address above.
          {provider === 'openai-compatible'
            ? ' Any server speaking the OpenAI chat format works here, including OpenRouter and a local Ollama or LM Studio, which keeps the whole thing on your own machine.'
            : ' Requests go straight to api.anthropic.com.'}
        </Footnote>

        <Card padded={false} style={settingsStyles.sectionStacked}>
          <SettingToggle
            icon="document-text-outline"
            label="Summarise finished workouts"
            description="Writes a few sentences on the finish screen without being asked."
            value={settings.aiAutoSummary}
            onChange={(value) => update('aiAutoSummary', value)}
            disabled={!settings.aiEnabled}
            disabledReason="Turn the AI coach on first."
          />
          <Divider inset={spacing.lg} />
          <SettingChoice
            icon="trending-up-outline"
            label="Training level"
            description="Which weekly set targets your volume is judged against."
            options={TRAINING_LEVELS.map((value) => ({
              value,
              label: TRAINING_LEVEL_LABELS[value],
            }))}
            value={settings.trainingLevel}
            onChange={(value) => update('trainingLevel', value)}
          />
        </Card>
        <Footnote>
          Training level is not an AI setting. It picks the weekly set landmarks the volume advice
          is measured against, and those are a published table this app calculates from, with or
          without a model. A beginner needs fewer sets to grow than the intermediate figures the
          statistics screens assume.
        </Footnote>
      </Reveal>

      <PromptModal
        visible={prompt !== null}
        title={prompt?.title ?? ''}
        message={prompt?.message}
        placeholder={prompt?.placeholder}
        initialValue={prompt?.initialValue ?? ''}
        maxLength={prompt?.maxLength}
        // Every field here is an identifier, and clearing one is how the user
        // asks for the default back rather than an empty value.
        allowEmpty
        inputProps={RAW_INPUT}
        onCancel={() => setEditing(null)}
        onConfirm={(value) => {
          const field = editing;
          setEditing(null);
          if (field === 'key') void saveKey(value);
          else if (field === 'model') update('aiModel', value);
          else if (field === 'baseUrl') update('aiBaseUrl', value);
        }}
      />
    </SettingsPage>
  );
}

/**
 * What the one dialog says, per field.
 *
 * The key's `initialValue` is empty rather than the stored key, deliberately.
 * Reading a credential back into an editable box is how it ends up in a
 * screenshot, and there is nothing to edit in a key anyway: it is replaced or
 * removed, and removing it has its own row.
 */
function promptFor(editing: Editing, model: string, baseUrl: string, provider: AiProvider) {
  switch (editing) {
    case 'key':
      return {
        title: 'API key',
        message: `Pasted from your ${AI_PROVIDER_LABELS[provider]} account. Stored in this device's keychain.`,
        placeholder: provider === 'anthropic' ? 'sk-ant-…' : 'sk-…',
        initialValue: '',
        // Keys run well past the 80 characters a rename dialog allows, and a
        // key silently truncated on paste is rejected as a wrong key.
        maxLength: 400,
      };
    case 'model':
      return {
        title: 'Model',
        message: `Leave empty for ${DEFAULT_AI_MODELS[provider]}.`,
        placeholder: DEFAULT_AI_MODELS[provider],
        initialValue: model,
        maxLength: 120,
      };
    case 'baseUrl':
      return {
        title: 'Base URL',
        message: `Leave empty for ${DEFAULT_BASE_URLS[provider]}. A bare address gets /v1 added; one that already ends in a version (/v1, /v4) is used as it stands.`,
        placeholder: 'http://localhost:11434',
        initialValue: baseUrl,
        maxLength: 200,
      };
    default:
      return null;
  }
}
