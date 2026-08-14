import { ArrowUpRight } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import { AUTHOR_PROFILE_URL, REPOSITORY_URL } from '@/lib/site'
import { cx } from '@/lib/utils'

type BrandIcon = ComponentType<SVGProps<SVGSVGElement>>

export interface ProfileLink {
  readonly href: string
  readonly label: string
  readonly icon: BrandIcon
  readonly iconColor: string
  readonly surfaceClassName: string
}

function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M12 .7C5.7.7.7 5.8.7 12.1c0 5 3.2 9.3 7.7 10.8.6.1.8-.2.8-.5v-2.2c-3.1.7-3.8-1.3-3.8-1.3-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.5-.3-5.1-1.2-5.1-5.6 0-1.2.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.3-5.1 5.6.4.3.8 1 .8 2v3.1c0 .3.2.6.8.5a11.4 11.4 0 0 0 7.7-10.8C23.3 5.8 18.3.7 12 .7Z" />
    </svg>
  )
}

function LinkedInMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V8.98h3.42v1.57h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.29ZM5.32 7.41a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12Zm1.78 13.04H3.54V8.98H7.1v11.47ZM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.72V1.72C24 .77 23.21 0 22.23 0Z" />
    </svg>
  )
}

export const EXECUTIVE_PROFILE_LINKS: readonly ProfileLink[] = [
  {
    href: REPOSITORY_URL,
    label: 'GitHub Repository',
    icon: GitHubMark,
    iconColor: '#24292f',
    surfaceClassName: cx(
      'border-[#d0d7de] bg-[#ffffff]',
      'shadow-[0_1px_3px_rgba(15,23,42,0.10)]',
      'hover:border-[#afb8c1] hover:bg-[#f6f8fa]',
      'hover:shadow-[0_3px_8px_rgba(15,23,42,0.14)]'
    ),
  },
  {
    href: AUTHOR_PROFILE_URL,
    label: 'LinkedIn Profile',
    icon: LinkedInMark,
    iconColor: '#0A66C2',
    surfaceClassName: cx(
      'border-[#b7d5f2] bg-[#f5faff]',
      'shadow-[0_1px_3px_rgba(10,102,194,0.10)]',
      'hover:border-[#79b5e8] hover:bg-[#edf6ff]',
      'hover:shadow-[0_3px_8px_rgba(10,102,194,0.14)]'
    ),
  },
]

const BADGE_BASE = cx(
  'group inline-flex min-h-touch w-full items-center justify-start gap-2 rounded-lg px-4',
  'border text-sm font-medium text-ink',
  'sm:min-h-9 sm:w-auto sm:justify-center sm:px-3',
  'transition-[background-color,border-color,box-shadow,transform]',
  'duration-(--arpi-motion-fast) ease-(--arpi-ease-standard)',
  'hover:-translate-y-px active:translate-y-px'
)

export function ExecutiveProfileLinks() {
  return (
    <div
      data-profile-links
      className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center"
    >
      {EXECUTIVE_PROFILE_LINKS.map(
        ({ href, label, icon: Icon, iconColor, surfaceClassName }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cx(BADGE_BASE, surfaceClassName)}
          >
            <Icon
              aria-hidden="true"
              className="size-[18px] shrink-0"
              style={{ color: iconColor }}
            />

            <span>{label}</span>

            <ArrowUpRight
              aria-hidden="true"
              className={cx(
                'ml-auto size-3.5 shrink-0 text-ink-faint',
                'transition-colors duration-(--arpi-motion-fast)',
                'group-hover:text-ink-secondary sm:ml-0'
              )}
              strokeWidth={2}
            />

            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )
      )}
    </div>
  )
}
