import { useEffect } from "react";
import { trackRoute } from "../activity.ts";
import { useApp } from "../store.tsx";
import { navigate, StorageBanner, SyncChip, UpdateBanner, useRoute } from "./common.tsx";
import { Cook } from "./Cook.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { Meals } from "./Meals.tsx";
import { ReportIssue } from "./ReportIssue.tsx";
import { RecipeEditor } from "./RecipeEditor.tsx";
import { Explore, Kitchen, You } from "./Screens.tsx";
import { PRIVACY_NOTICE } from "@betterplate/contracts";
import { ConsentScreen, PrivacyPage } from "./Privacy.tsx";
import { SharedRecipePage } from "./Share.tsx";
import { SignIn } from "./SignIn.tsx";
import { Goals } from "./Goals.tsx";
import { AiSettings } from "./AiSettings.tsx";
import { Groups, GroupScreen, JoinGroup } from "./Groups.tsx";
import { Preferences } from "./Preferences.tsx";
import { Shopping } from "./Shopping.tsx";
import { Companion, CompanionButton } from "./Companion.tsx";
import { ConnectConsent, ResumeConnect, takePendingConnect } from "./Connect.tsx";
import { useT, type MessageKey } from "../i18n.ts";

const NAV: { path: string; label: MessageKey; icon: IconName }[] = [
  { path: "/kitchen", label: "nav.kitchen", icon: "kitchen" },
  { path: "/create", label: "nav.create", icon: "plus" },
  { path: "/explore", label: "nav.explore", icon: "search" },
  { path: "/you", label: "nav.you", icon: "user" },
];

export function App() {
  const { account, accountChecked } = useApp();
  const route = useRoute();
  const t = useT();

  useEffect(() => trackRoute(route), [route]);

  // Back from a full-page sign-in (Google) in the middle of connecting an assistant.
  useEffect(() => {
    if (!account) return;
    const pending = takePendingConnect();
    if (pending) navigate(pending);
  }, [account]);

  useEffect(() => {
    if (route === "/create") navigate(`/recipe/${crypto.randomUUID()}`);
  }, [route]);

  // Shared recipes open for anyone with the link, signed in or not.
  const sharedMatch = /^\/shared\/([^/]+)$/.exec(route);
  if (sharedMatch) {
    return (
      <>
        <SharedRecipePage key={sharedMatch[1]} shareId={sharedMatch[1]!} />
        <ReportIssue route="/shared" />
      </>
    );
  }

  if (route === "/privacy") {
    return (
      <>
        <PrivacyPage />
        <ReportIssue route="/privacy" />
      </>
    );
  }

  if (!account) {
    if (!accountChecked) return <p className="hint pad">{t("app.opening")}</p>;
    return (
      <>
        <SignIn />
        <ReportIssue route="/sign-in" />
      </>
    );
  }

  // Known to be behind the current notice (an account remembered offline without this info is not blocked).
  if (account.privacy && account.privacy.acceptedVersion !== PRIVACY_NOTICE.version) {
    return (
      <>
        <ConsentScreen />
        <ReportIssue route="/consent" />
      </>
    );
  }

  // An assistant (Claude, ChatGPT) asking to connect; sign-in above comes first when needed.
  const connectMatch = /^\/connect(\/login)?\?(.+)$/.exec(route);
  if (connectMatch) {
    return (
      <>
        {connectMatch[1] ? <ResumeConnect query={connectMatch[2]!} /> : <ConnectConsent query={connectMatch[2]!} />}
        <ReportIssue route="/connect" />
      </>
    );
  }

  const cookMatch = /^\/cook\/([0-9a-f-]{36})$/.exec(route);
  if (cookMatch) return <Cook key={cookMatch[1]} id={cookMatch[1]!} report={<ReportIssue route={route} className="report-btn icon-btn" />} />;

  const recipeMatch = /^\/recipe\/([0-9a-f-]{36})$/.exec(route);
  const mealsMatch = /^\/meals(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(route);
  const shoppingMatch = /^\/shopping(?:\/group\/([0-9a-f-]{36}))?$/.exec(route);
  const groupMatch = /^\/groups\/([0-9a-f-]{36})$/.exec(route);
  const joinMatch = /^\/join\/([0-9a-f-]{36})$/.exec(route);
  const inKitchen = !!(recipeMatch || mealsMatch || shoppingMatch);
  const inYou = ["/goals", "/targets", "/ai", "/groups", "/preferences"].includes(route) || !!groupMatch || !!joinMatch;
  const section = inKitchen ? "/kitchen" : inYou ? "/you" : route;
  let screen;
  if (recipeMatch) screen = <RecipeEditor key={recipeMatch[1]} id={recipeMatch[1]!} />;
  else if (mealsMatch) screen = <Meals date={mealsMatch[1]} />;
  else if (route === "/explore") screen = <Explore />;
  else if (route === "/you") screen = <You />;
  else if (route === "/goals" || route === "/targets") screen = <Goals />;
  else if (route === "/ai") screen = <AiSettings />;
  else if (shoppingMatch) screen = <Shopping key={shoppingMatch[1] ?? "own"} groupId={shoppingMatch[1]} />;
  else if (route === "/preferences") screen = <Preferences />;
  else if (route === "/groups") screen = <Groups />;
  else if (groupMatch) screen = <GroupScreen key={groupMatch[1]} id={groupMatch[1]!} />;
  else if (joinMatch) screen = <JoinGroup key={joinMatch[1]} token={joinMatch[1]!} />;
  else screen = <Kitchen />;

  return (
    <div className={`shell${recipeMatch ? " has-action-bar" : ""}`}>
      <a className="skip" href="#main">
        {t("app.skip")}
      </a>
      <nav className="nav" aria-label={t("nav.main")}>
        <span className="brand" aria-hidden="true">
          The Better Plate
        </span>
        {NAV.map((n) => (
          <a key={n.path} href={`#${n.path}`} className="nav-item" aria-current={section === n.path ? "page" : undefined}>
            <span className="nav-icon">
              <Icon name={n.icon} size={22} />
            </span>
            {t(n.label)}
          </a>
        ))}
      </nav>
      <div className="content">
        <div className="topbar">
          {inKitchen ? (
            <a className="back" href="#/kitchen" aria-label={t("nav.backToKitchen")}>
              <Icon name="back" /> {t("nav.kitchen")}
            </a>
          ) : groupMatch ? (
            <a className="back" href="#/groups">
              <Icon name="back" /> {t("groups.title")}
            </a>
          ) : inYou ? (
            <a className="back" href="#/you">
              <Icon name="back" /> {t("nav.you")}
            </a>
          ) : (
            <span />
          )}
          <span className="topbar-actions">
            <CompanionButton />
            <SyncChip />
          </span>
        </div>
        <UpdateBanner />
        <StorageBanner />
        <main id="main">{screen}</main>
      </div>
      <ReportIssue route={route} />
      <Companion />
    </div>
  );
}
