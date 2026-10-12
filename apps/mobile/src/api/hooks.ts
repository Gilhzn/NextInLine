import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BenefitCategory,
  ClaimDto,
  CoverageItemDto,
  EnrollmentDto,
  FeeDto,
  HomeDto,
  MeDto,
  MemberDto,
  OnboardingStep,
  PlanDto,
  ReceiptDto,
  RoutingResult,
  SubmissionPackDto,
} from "@magiali/shared";
import { api } from "./client";

export const keys = {
  me: ["me"] as const,
  home: ["home"] as const,
  claims: ["claims"] as const,
  claim: (id: string) => ["claims", id] as const,
  receipts: ["receipts"] as const,
  receipt: (id: string) => ["receipts", id] as const,
  plans: ["plans"] as const,
  coverage: ["coverage"] as const,
  coverageSearch: (q: string) => ["coverage", "search", q] as const,
  members: ["members"] as const,
  enrollments: (memberId: string) => ["members", memberId, "enrollments"] as const,
  fees: ["fees"] as const,
  pack: (claimId: string, legId: string) => ["claims", claimId, "pack", legId] as const,
  notifications: ["notifications"] as const,
  publicConfig: ["public-config"] as const,
};

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { claimId?: string; receiptId?: string; feeId?: string; memberId?: string; screen?: string } | null;
  createdAt: string;
  readAt: string | null;
}

/** Works signed-out: tells the app whether the fixed demo login code is active. */
export const usePublicConfig = () =>
  useQuery({
    queryKey: keys.publicConfig,
    queryFn: () =>
      api<{ demoMode: boolean; demoLoginCode: string | null; openBanking: boolean; emailInbox: boolean }>("GET", "/v1/public-config"),
    staleTime: Infinity,
  });

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => api<NotificationItem[]>("GET", "/v1/notifications"),
    refetchInterval: 30_000,
  });

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("POST", `/v1/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export const useMe = (enabled = true) => useQuery({ queryKey: keys.me, queryFn: () => api<MeDto>("GET", "/v1/me"), enabled });
export const useHome = () => useQuery({ queryKey: keys.home, queryFn: () => api<HomeDto>("GET", "/v1/home") });
export const useClaims = () => useQuery({ queryKey: keys.claims, queryFn: () => api<ClaimDto[]>("GET", "/v1/claims") });
export const useClaim = (id: string) =>
  useQuery({ queryKey: keys.claim(id), queryFn: () => api<ClaimDto>("GET", `/v1/claims/${id}`), enabled: !!id });
export const usePlans = () =>
  useQuery({ queryKey: keys.plans, queryFn: () => api<PlanDto[]>("GET", "/v1/catalog/plans"), staleTime: 3_600_000 });
export const useCoverageMap = () =>
  useQuery({ queryKey: keys.coverage, queryFn: () => api<CoverageItemDto[]>("GET", "/v1/coverage/map") });
export const useMembers = () => useQuery({ queryKey: keys.members, queryFn: () => api<MemberDto[]>("GET", "/v1/members") });
export const useEnrollments = (memberId: string) =>
  useQuery({
    queryKey: keys.enrollments(memberId),
    queryFn: () => api<EnrollmentDto[]>("GET", `/v1/members/${memberId}/enrollments`),
    enabled: !!memberId,
  });
export const useFees = () => useQuery({ queryKey: keys.fees, queryFn: () => api<FeeDto[]>("GET", "/v1/fees") });
export const useUnclaimedReceipts = (poll = false) =>
  useQuery({
    queryKey: [...keys.receipts, "unclaimed"],
    queryFn: () => api<ReceiptDto[]>("GET", "/v1/receipts?unclaimed=true"),
    refetchInterval: poll ? 3000 : false,
  });

/** Polls while the AI is still reading the receipt. */
export const useReceipt = (id: string) =>
  useQuery({
    queryKey: keys.receipt(id),
    queryFn: () => api<ReceiptDto>("GET", `/v1/receipts/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.extractionStatus;
      return s === "pending" || s === "processing" ? 2000 : false;
    },
  });

export const useCoverageSearch = (q: string) =>
  useQuery({
    queryKey: keys.coverageSearch(q),
    queryFn: () =>
      api<{ categories: Array<{ category: BenefitCategory; label: string; icon: string }>; items: CoverageItemDto[] }>(
        "GET",
        `/v1/coverage/search?q=${encodeURIComponent(q)}`,
      ),
    enabled: q.trim().length >= 2,
  });

export const usePack = (claimId: string, legId: string) =>
  useQuery({
    queryKey: keys.pack(claimId, legId),
    queryFn: () => api<SubmissionPackDto>("GET", `/v1/claims/${claimId}/legs/${legId}/pack`),
  });

export function useSetOnboardingStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (step: OnboardingStep) => api<MeDto>("PATCH", "/v1/me", { onboardingStep: step }),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export type { RoutingResult };

/** Screens a notification may open by name (anything else is ignored). */
export const NOTIFICATION_SCREENS = ["/money", "/before-booking", "/entitlements", "/email-receipts", "/connect-bank"] as const;
export const notificationScreen = (screen: unknown) =>
  NOTIFICATION_SCREENS.find((s) => s === screen) ?? null;
