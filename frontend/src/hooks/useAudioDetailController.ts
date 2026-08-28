import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "../api";
import type { AISuggestions, AudioItem, Tag, Transcript } from "../types";
import type { EditingPatch, NumericSelection, ToastType } from "../components/detail/types";
import { toErrorMessage } from "../i18n/errors";

type Options = {
  audio: AudioItem | null;
  refresh: () => void;
  notify?: (message: string, type?: ToastType) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

const METADATA_KEYS: Array<keyof AudioItem> = [
  "title_user",
  "author_user",
  "album_user",
  "description_user",
  "language",
  "is_favorite"
];

function metadataFor(audio: AudioItem): Partial<AudioItem> {
  return {
    title_user: audio.title_user || "",
    author_user: audio.author_user || "",
    album_user: audio.album_user || "",
    description_user: audio.description_user || "",
    language: audio.language || "",
    is_favorite: audio.is_favorite
  };
}

async function optionalNotFound<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function useAudioDetailController({
  audio,
  refresh,
  notify,
  onDirtyChange
}: Options) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [editing, setEditing] = useState<Partial<AudioItem>>({});
  const [metadataBaseline, setMetadataBaseline] = useState<Partial<AudioItem>>({});
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [metadataLoadError, setMetadataLoadError] = useState("");
  const [detailLoadAttempt, setDetailLoadAttempt] = useState(0);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [metadataSaveError, setMetadataSaveError] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestions | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<NumericSelection>("");
  const [relocatePath, setRelocatePath] = useState("");
  const [coverVersion, setCoverVersion] = useState(Date.now());
  const lastLoadedAudioIdRef = useRef<number | null>(null);

  const acceptedTagNames = useMemo(
    () => new Set(tags.map((tag) => tag.name)),
    [tags]
  );
  const availableExistingTags = useMemo(
    () => allTags.filter((tag) => !acceptedTagNames.has(tag.name)),
    [allTags, acceptedTagNames]
  );
  const metadataDirty = METADATA_KEYS.some(
    (key) => editing[key] !== metadataBaseline[key]
  );

  useEffect(() => {
    onDirtyChange?.(metadataDirty);
    return () => onDirtyChange?.(false);
  }, [metadataDirty, onDirtyChange]);

  useEffect(() => {
    let canceled = false;

    async function load() {
      setTranscript(null);
      setAiSuggestions(null);
      if (!audio) {
        setTags([]);
        setAllTags([]);
        setEditing({});
        setMetadataLoaded(false);
        setMetadataLoadError("");
        setRelocatePath("");
        setTagInput("");
        setSelectedPlaylist("");
        setMetadataSaveError("");
        lastLoadedAudioIdRef.current = null;
        return;
      }

      const audioIdChanged = lastLoadedAudioIdRef.current !== audio.id;
      setMetadataLoadError("");
      if (audioIdChanged) {
        setMetadataLoaded(false);
        setRelocatePath("");
        setTagInput("");
        setSelectedPlaylist("");
        setMetadataSaveError("");
        setCoverVersion(Date.now());
      }
      const [detail, tagRows, transcriptValue, suggestionsValue] = await Promise.all([
        api.getAudioDetail(audio.id),
        api.listTags(),
        optionalNotFound(api.getTranscript(audio.id)),
        api.getAiSuggestions(audio.id)
      ]);
      if (canceled) return;
      lastLoadedAudioIdRef.current = audio.id;
      setTags(detail.tags);
      setAllTags(tagRows);
      setTranscript(transcriptValue);
      setAiSuggestions(suggestionsValue);
      if (audioIdChanged) {
        const metadata = metadataFor(detail.audio);
        setEditing(metadata);
        setMetadataBaseline(metadata);
        setMetadataLoaded(true);
      }
    }

    load().catch((error) => {
      if (canceled) return;
      const message = toErrorMessage(error);
      setMetadataLoadError(message);
      notify?.(message, "error");
    });
    return () => {
      canceled = true;
    };
  }, [
    audio?.id,
    audio?.updated_at,
    audio?.ai_status,
    audio?.transcript_status,
    detailLoadAttempt
  ]);

  function updateEditing(patch: EditingPatch) {
    setMetadataSaveError("");
    setEditing((current) => ({ ...current, ...patch }));
  }

  function discardMetadataChanges() {
    setEditing({ ...metadataBaseline });
    setMetadataSaveError("");
  }

  async function saveMetadata() {
    if (!audio || isSavingMetadata) return;
    setIsSavingMetadata(true);
    setMetadataSaveError("");
    try {
      await api.updateAudio(audio.id, editing);
      setMetadataBaseline({ ...editing });
      notify?.(t("detail.notifications.metadataSaved"), "success");
      refresh();
    } catch (error) {
      const message = toErrorMessage(error);
      setMetadataSaveError(message);
      notify?.(message, "error");
    } finally {
      setIsSavingMetadata(false);
    }
  }

  async function reloadTagsAndSuggestions() {
    if (!audio) return;
    const [detail, tagRows] = await Promise.all([
      api.getAudioDetail(audio.id),
      api.listTags()
    ]);
    setTags(detail.tags);
    setAllTags(tagRows);
    setAiSuggestions(await api.getAiSuggestions(audio.id));
  }

  return {
    tags,
    tagInput,
    setTagInput,
    editing,
    metadataLoaded,
    metadataLoadError,
    retryMetadataLoad: () => setDetailLoadAttempt((value) => value + 1),
    isSavingMetadata,
    metadataSaveError,
    metadataDirty,
    transcript,
    setTranscript,
    aiSuggestions,
    selectedPlaylist,
    setSelectedPlaylist,
    relocatePath,
    setRelocatePath,
    coverVersion,
    refreshCover: () => setCoverVersion(Date.now()),
    acceptedTagNames,
    availableExistingTags,
    updateEditing,
    discardMetadataChanges,
    saveMetadata,
    reloadTagsAndSuggestions
  };
}
