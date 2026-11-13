import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { refocusAfterSave } from "../../components/StorageNotice";
import { showToast } from "../../components/Toast";
import { useStrings, type Strings } from "../../lib/i18n";
import {
  addToCollection,
  collectionKey,
  getCollectionSaveState,
  isCardSaved,
  retryCollectionSave,
  setCollectionThumb,
  setQuantity,
  useCollection,
  useCollectionSaveState,
} from "../../lib/store";
import type { CardDetail } from "../../lib/types";

type Key =
  | "add"
  | "owned"
  | "added"
  | "addedMore"
  | "removed"
  | "less"
  | "more"
  | "notSaved"
  | "otherNotSaved"
  | "someNotSaved"
  | "stillUnsaved"
  | "saveAgain"
  | "savedNow";

const STRINGS: Strings<Key> = {
  ko: {
    add: "내 카드에 추가",
    owned: "내 카드에 있어요 ({n}장)",
    added: "내 카드에 넣었어요!",
    addedMore: "이제 {n}장이에요!",
    removed: "내 카드에서 뺐어요",
    less: "한 장 빼기",
    more: "한 장 더하기",
    notSaved: "아직 저장 안 됐어요. 앱을 닫으면 사라져요.",
    otherNotSaved: "이 카드는 저장돼 있어요. 아직 저장 안 된 다른 카드가 있어요.",
    someNotSaved: "아직 저장 안 된 카드가 있어요.",
    stillUnsaved: "아직 저장하지 못했어요. 어른에게 보여 주세요.",
    saveAgain: "다시 저장하기",
    savedNow: "저장했어요!",
  },
  en: {
    add: "Add to My Cards",
    owned: "In My Cards ({n})",
    added: "Added to My Cards!",
    addedMore: "Now you have {n}!",
    removed: "Removed from My Cards",
    less: "Remove one",
    more: "Add one more",
    notSaved: "Not saved yet. It will be gone when the app closes.",
    otherNotSaved: "This card is saved. Some other cards aren’t saved yet.",
    someNotSaved: "Some cards aren’t saved yet.",
    stillUnsaved: "Still not saved. Show a grown‑up.",
    saveAgain: "Try saving again",
    savedNow: "Saved!",
  },
};

const THUMB_WIDTH = 200;

/** Scan photos are ~320px; collection thumbs share a small localStorage budget, so store them smaller. */
function shrinkPhoto(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth <= THUMB_WIDTH) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_WIDTH;
      canvas.height = Math.round(
        (img.naturalHeight * THUMB_WIDTH) / img.naturalWidth,
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
      canvas.width = canvas.height = 0; // free the bitmap now: iOS has a tight canvas memory budget
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export interface CollectButtonProps {
  card: CardDetail;
  variantKey: string;
  /** The user's scan photo, saved as the thumbnail when TCGdex has no picture of this card. */
  photo?: string;
}

/**
 * "+ Add to My Cards", or "✓ In My Cards (2)" with a − / + stepper once added. When My Cards could not be saved
 * (storage blocked or full), it says so under the button, with a way to try again, instead of cheering: in amber when
 * this card is the one not saved, quietly when it is saved and another change isn't.
 */
export function CollectButton({ card, variantKey, photo }: CollectButtonProps) {
  const t = useStrings(STRINGS);
  const key = collectionKey(card, variantKey);
  const qty = useCollection().find((i) => i.key === key)?.qty ?? 0;
  const { saved } = useCollectionSaveState();
  const [stillFailing, setStillFailing] = useState(false);
  /** The Add button or the "In My Cards" label: focus goes there when the box with "try again" goes away. */
  const anchor = useRef<HTMLElement | null>(null);
  // Read only while something isn't saved (it reads storage).
  const thisCardUnsaved = !saved && qty > 0 && !isCardSaved(key);
  useEffect(() => {
    if (saved) setStillFailing(false);
  }, [saved]);

  const add = () => {
    addToCollection(card, variantKey);
    if (qty === 0 && photo && !card.image)
      void shrinkPhoto(photo).then((thumb) => setCollectionThumb(key, thumb));
    // Not saved: App's "couldn't save" toast and the line under the button speak instead.
    if (getCollectionSaveState().saved)
      showToast(qty === 0 ? t("added") : t("addedMore", { n: qty + 1 }), {
        icon: "✨",
      });
  };

  const saveAgain = () => {
    if (retryCollectionSave()) {
      setStillFailing(false);
      showToast(t("savedNow"), { icon: "✅" });
      refocusAfterSave(anchor.current);
    } else {
      // App's "couldn't save" toast speaks at most once a minute: answer this tap here.
      setStillFailing(true);
    }
  };

  const unsaved = !saved && (
    <div
      className={thisCardUnsaved ? "card-unsaved" : "card-unsaved card-unsaved-other"}
      role="status"
    >
      <p className="small card-unsaved-text">
        {thisCardUnsaved && <span aria-hidden="true">⚠️ </span>}
        {t(thisCardUnsaved ? "notSaved" : qty > 0 ? "otherNotSaved" : "someNotSaved")}
      </p>
      <button
        type="button"
        className="btn btn-secondary card-unsaved-retry"
        onClick={saveAgain}
      >
        {t("saveAgain")}
      </button>
      {stillFailing && (
        <p className="small card-unsaved-still">
          <span aria-hidden="true">⚠️ </span>
          {t("stillUnsaved")}
        </p>
      )}
    </div>
  );

  const removeOne = () => {
    setQuantity(key, qty - 1);
    if (qty === 1) showToast(t("removed"));
  };

  if (qty === 0) {
    const button = (
      <button
        ref={(el) => {
          anchor.current = el;
        }}
        type="button"
        className="btn btn-primary btn-lg btn-block"
        onClick={add}
      >
        <Icon name="plus" />
        {t("add")}
      </button>
    );
    // Always in the same wrapper, so the button stays the same element (and keeps focus) when the line comes and goes.
    return (
      <div className="card-collect">
        {button}
        {unsaved}
      </div>
    );
  }

  return (
    <div className="card-collect">
      <div
        className={
          thisCardUnsaved
            ? "card-owned card-owned-unsaved pop-in"
            : "card-owned pop-in"
        }
      >
        <span
          className="card-owned-label"
          ref={(el) => {
            anchor.current = el;
          }}
          tabIndex={-1}
        >
          <span className="card-owned-check" aria-hidden="true">
            <Icon name="check" size={18} strokeWidth={3} />
          </span>
          {t("owned", { n: qty })}
        </span>
        <div className="card-stepper">
          <button
            type="button"
            className="btn btn-icon"
            onClick={removeOne}
            aria-label={t("less")}
          >
            <Icon name="minus" />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={add}
            aria-label={t("more")}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {unsaved}
    </div>
  );
}
