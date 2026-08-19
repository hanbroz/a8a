import { useCallback, useState } from 'react'
import ConfirmDialog from '../ConfirmDialog'
import { useI18n } from '../../i18n'

interface UseDirtyCloseResult {
  // 모달 최상위 요소에 펼쳐 넣는다. 안쪽 입력의 변경을 캡처 단계에서 한 번에 받는다.
  dirtyProps: { onInputCapture: () => void; onChangeCapture: () => void }
  requestClose: () => void
  dirtyDialog: JSX.Element | null
}

/**
 * 저장하지 않고 닫으려 할 때(X 버튼 / 취소 / ESC) 확인창을 띄운다.
 * 저장 후 닫기 경로는 onClose 를 그대로 호출하므로 이 확인창을 지나지 않는다.
 */
export function useDirtyClose(onClose: () => void): UseDirtyCloseResult {
  const { t } = useI18n()
  const [dirty, setDirty] = useState(false)
  const [asking, setAsking] = useState(false)

  const markDirty = useCallback((): void => setDirty(true), [])

  const requestClose = useCallback((): void => {
    if (dirty) setAsking(true)
    else onClose()
  }, [dirty, onClose])

  return {
    // ponytail: input/change 이벤트만 본다. 타이핑·체크박스·셀렉트·파일선택은 잡히지만
    // 버튼으로만 바뀌는 값(행 추가 등)은 못 잡아 예전처럼 바로 닫힌다.
    // 그것까지 필요하면 각 모달에서 저장용 config 를 만들어 초기값과 비교해야 한다.
    dirtyProps: { onInputCapture: markDirty, onChangeCapture: markDirty },
    requestClose,
    dirtyDialog: asking
      ? (
          <ConfirmDialog
            title={t('confirm.discardChanges.title')}
            message={t('confirm.discardChanges.message')}
            warning={t('confirm.discardChanges.warning')}
            confirmLabel={t('confirm.discardChanges.confirm')}
            onConfirm={onClose}
            onCancel={() => setAsking(false)}
          />
        )
      : null,
  }
}
