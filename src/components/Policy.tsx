import { Link, useParams } from "react-router-dom";
const policies: Record<
  string,
  { title: string; sections: [string, string][] }
> = {
  privacy: {
    title: "Privacy",
    sections: [
      [
        "Browser identity",
        "Your handle and optional tag are saved in this browser. They are not verified identities. EPUB reading progress and private submission receipts also stay in browser storage. You can clear a saved handle below. Clearing submission receipts removes access to your private submission status.",
      ],
      [
        "Public posts",
        "Margins are public for 72 hours. The API stops returning expired posts. Database rows are purged on feed visits and scheduled cleanup. Database backups and service logs may retain earlier copies; we do not promise immediate deletion from every retained system. Book-specific notes remain until removed through moderation or a future deletion request.",
      ],
      [
        "Presence and activity",
        "An approximate active-reader count uses temporary visitor IDs and recent heartbeats. Downloads and contributions may create shared activity events. We do not publish a personalized reading history. Infrastructure providers may process IP addresses and request logs.",
      ],
      [
        "Reports and contributions",
        "Reports are private to operators. Reporting uses a daily keyed hash of the request address for duplicate control; raw addresses are not stored in the report table. Reports expire after 30 days or earlier when the referenced post is deleted. Submission metadata, source links and rights declarations are private until review. No private file uploads are accepted in this version.",
      ],
      [
        "Services and analytics",
        "Vercel hosts the app, Neon stores production metadata and posts, and existing contributed files use Vercel Blob. External reading files may be served by Gutenberg or Internet Archive, under their own practices. We have not added advertising trackers or a third-party analytics service. Daily aggregate counts record new posts, reports, submissions and download requests without handles, search text or personal reading histories. Download counters record requests, not completed reads. Source cover images may load from an external provider.",
      ],
      [
        "Contact and requests",
        "Use the report control on a book or post for privacy, impersonation or removal concerns. A dedicated public legal contact and verified operator identity have not yet been configured. These pages describe current product behavior and are not a claim of legal compliance.",
      ],
    ],
  },
  guidelines: {
    title: "Community guidelines",
    sections: [
      [
        "Make room for other readers",
        "Discuss books and ideas without harassment, threats, hate, sexual exploitation, or sharing private personal information. Do not impersonate another person or claim a browser handle is verified.",
      ],
      [
        "Keep it literary",
        "No spam, scams, deceptive promotion, or links to unlawful copies. Margins are text-only and limited to 500 characters. Book notes are for conversations about that title.",
      ],
      [
        "Reporting and moderation",
        "Use Report on a book or post. Reports are private; a report does not automatically remove content. Operators can hide content and review submissions. Reports are not continuously monitored and this is not an emergency-response service.",
      ],
      [
        "A temporary room",
        "Margins leave the public feed after three days. That does not guarantee deletion from logs or backups at the same moment. Do not post information you need to keep private.",
      ],
    ],
  },
  copyright: {
    title: "Copyright & source rights",
    sections: [
      [
        "Authorized distribution",
        "Submit only a work you own or have permission to distribute, or a source with a verifiable public-domain or open-license basis. Online availability alone does not establish redistribution rights. Public-domain status can differ by jurisdiction.",
      ],
      [
        "Source attribution",
        "Imported reading editions reference external sources and their licensing statements. A rights label records the source assertion or a reviewed permission statement; it is not a universal legal determination. Use the original source link when you need licensing details.",
      ],
      [
        "Report a rights concern",
        "Open the book and choose Report → Copyright or distribution rights. Identify the work, the disputed link and the basis of your claim. Do not put private contact information in a public post. Operators can remove a title from public access while reviewing a concern.",
      ],
      [
        "Formal notices",
        "A designated legal contact and jurisdiction-specific notice procedure are not configured yet. In-app reporting is available, but it must not be represented as a complete statutory takedown process. A dedicated contact is required before a broad publishing launch.",
      ],
    ],
  },
  terms: {
    title: "Terms of use",
    sections: [
      [
        "Use ShelfChat responsibly",
        "Use the library and community lawfully. Do not distribute works without appropriate rights, abuse public endpoints, impersonate others, or bypass publication review. Access and external file availability can change.",
      ],
      [
        "Your contributions",
        "You retain your rights in submitted content. A submission requests permission for ShelfChat to display its approved metadata and provide the authorized free reading link you supplied. Pending submissions are not public. A rights checkbox alone does not prove ownership; operator review is required.",
      ],
      [
        "Community identity",
        "Participation uses an unverified browser handle. It is not an account, age check, verified author profile, or guarantee of control across devices. Never rely on a handle alone when sharing private information or making agreements.",
      ],
      [
        "Availability and future services",
        "This version does not sell books, accept paid promotions, or provide subscriptions. No paid entitlement can be granted through browser state. Future commercial terms require a separate release and clear disclosure.",
      ],
      [
        "Review status",
        "These are early-stage product rules, not a representation that a complete legal agreement or regulatory review has been completed. The founder still needs to establish an operator identity, legal contact and applicable legal review.",
      ],
    ],
  },
  submissions: {
    title: "Submission terms",
    sections: [
      [
        "Free distribution",
        "Provide an existing HTTPS PDF or EPUB link, a description and a specific distribution-rights statement. Submission is free. Files are not uploaded to a private author store in this version.",
      ],
      [
        "Review comes first",
        "New submissions remain private and pending until an operator reviews permission and verifies a readable file. Approval is discretionary; rejected or unavailable links do not enter the public library. Existing externally hosted files remain governed by their provider.",
      ],
      [
        "Private receipts",
        "Your private receipt grants access to the submission status. Keep it private. This is not a verified author account and does not establish authorship or copyright ownership. Editing, author profiles and recovery across devices are not available yet.",
      ],
    ],
  },
};
export default function Policy() {
  const { page } = useParams();
  const policy = policies[page || ""];
  if (!policy)
    return (
      <section className="policy-page">
        <h1>Page not found</h1>
        <Link to="/">Library</Link>
      </section>
    );
  return (
    <section className="policy-page">
      <span className="eyebrow">SHELFCHAT / TRUST</span>
      <h1>{policy.title}</h1>
      {policy.sections.map(([title, text]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{text}</p>
        </section>
      ))}
      {page === "privacy" && (
        <button
          className="outline"
          onClick={() => {
            localStorage.removeItem("shelfchat.identity.v1");
            sessionStorage.removeItem("shelfchat.visitor");
            location.reload();
          }}
        >
          Clear this browser’s handle
        </button>
      )}
      <Link className="back" to="/">
        Back to the library
      </Link>
    </section>
  );
}
