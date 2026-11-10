// Inline SVG icons: 24×24 grid, stroked with currentColor, decorative (aria-hidden). Size with `size` (px, default 20).
// Usage: <Button icon={<PlayIcon />}>Start</Button>, <IconButton label="Delete" icon={<TrashIcon />} />
import type { ReactNode, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'ref'> {
  size?: number | string
}

function Svg({ size = 20, strokeWidth = 2, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4.6v14.8a1 1 0 0 0 1.53.85l11.84-7.4a1 1 0 0 0 0-1.7L8.53 3.75A1 1 0 0 0 7 4.6Z" fill="currentColor" />
    </Svg>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function MinusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
    </Svg>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </Svg>
  )
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </Svg>
  )
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5" />
    </Svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function VolumeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </Svg>
  )
}

export function VolumeMuteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </Svg>
  )
}

export function VoiceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.55L3 20.5l1.5-5.1A8.5 8.5 0 1 1 21 11.5Z" />
      <path d="M9 10v3M12.5 8v7M16 10v3" />
    </Svg>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 15V3.5M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </Svg>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5V15M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </Svg>
  )
}

export function SpeakerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <circle cx="12" cy="14.5" r="3.5" />
      <circle cx="12" cy="7" r="1" fill="currentColor" />
    </Svg>
  )
}

export function TapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 14.5V6.25a1.75 1.75 0 0 1 3.5 0V12" />
      <path d="M13 11.5v-1a1.75 1.75 0 0 1 3.5 0v1.5M16.5 12a1.75 1.75 0 0 1 3.5 0v2.5a7 7 0 0 1-7 7h-.6a6.5 6.5 0 0 1-5.2-2.6l-2.7-3.6a1.7 1.7 0 0 1 2.6-2.2l1.4 1.4" />
      <path d="M5 4.5 6.5 6M3.5 9H5.5M16 4.5 14.5 6" />
    </Svg>
  )
}

export function RepeatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </Svg>
  )
}

export function TrendUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m22 7-8.5 8.5-5-5L2 17" />
      <path d="M16 7h6v6" />
    </Svg>
  )
}

export function TrendDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m22 17-8.5-8.5-5 5L2 7" />
      <path d="M16 17h6v-6" />
    </Svg>
  )
}

export function MetronomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.6 3h4.8a1.2 1.2 0 0 1 1.16.9l4.06 15.6A1.2 1.2 0 0 1 18.46 21H5.54a1.2 1.2 0 0 1-1.16-1.5L8.44 3.9A1.2 1.2 0 0 1 9.6 3Z" />
      <path d="M6 16.5h12M12 16.5l5.5-12" />
      <path d="m12.8 11.4 2.5 1.2" strokeWidth="2.6" />
    </Svg>
  )
}

export function FlashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 2.5 4.5 13.5h7l-1 8 8.5-11h-7l1-8Z" />
    </Svg>
  )
}

export function MusicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18V5.5l12-2.5v12.5" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="15.5" r="3" />
    </Svg>
  )
}

export function SaveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-7.5a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5V21M7 3v4.5a.5.5 0 0 0 .5.5H15" />
    </Svg>
  )
}

export function EditIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16.9 3.6a2.1 2.1 0 0 1 3 3L7.5 19l-4 1 1-4L16.9 3.6Z" />
      <path d="m15 5.5 3 3" />
    </Svg>
  )
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </Svg>
  )
}
