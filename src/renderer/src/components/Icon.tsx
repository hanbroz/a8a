import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number
  strokeWidth?: number
}

const Icon = ({
  size = 16,
  strokeWidth = 1.6,
  children,
  ...rest
}: IconProps): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
)

export const IcoPanelL = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
  </Icon>
)

export const IcoMenu = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 12h18M3 6h18M3 18h18" />
  </Icon>
)

export const IcoPlay = (p: IconProps): JSX.Element => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M7 5v14l11-7z" />
  </Icon>
)

export const IcoSave = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </Icon>
)

export const IcoSun = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </Icon>
)

export const IcoMoon = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Icon>
)

export const IcoPanelB = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 15h18" />
  </Icon>
)

export const IcoFit = (p: IconProps): JSX.Element => (
  <Icon
    {...p}
    d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"
  />
)

export const IcoChevD = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const IcoPlus = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const IcoPencil = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </Icon>
)

export const IcoTrash = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Icon>
)

export const IcoX = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)

export const IcoMaximize = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M16 3h3a2 2 0 0 1 2 2v3" />
    <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
    <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
  </Icon>
)

export const IcoRestore = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="4" y="8" width="12" height="12" rx="2" />
    <path d="M8 4h10a2 2 0 0 1 2 2v10" />
  </Icon>
)

export const IcoReset = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Icon>
)

export const IcoUndo = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M9 7H4v5" />
    <path d="M4 12a8 8 0 1 0 2.35-5.65L4 8.7" />
  </Icon>
)

export const IcoRedo = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M15 7h5v5" />
    <path d="M20 12a8 8 0 1 1-2.35-5.65L20 8.7" />
  </Icon>
)

export const IcoDownload = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </Icon>
)

export const IcoUpload = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 21V9" />
    <path d="m7 14 5-5 5 5" />
    <path d="M5 3h14" />
  </Icon>
)

export const IcoCopy = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Icon>
)

export const IcoHelpCircle = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9a3 3 0 0 1 5.6 1.5c0 2-2.8 2.3-2.8 4" />
    <path d="M12 18h.01" />
  </Icon>
)

export const IcoSettings = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.52a2 2 0 0 1-1 1.72l-.15.1a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.52a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)
