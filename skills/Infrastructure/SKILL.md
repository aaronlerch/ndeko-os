---
name: Infrastructure
description: Route every cloud infrastructure mutation through Infrastructure-as-Code — find the Pulumi/Terraform project, write the change as code, preview it, and get explicit approval before applying. Cloud CLIs are for reading only. USE WHEN infrastructure change, deploy infrastructure, pulumi, terraform, gcloud create, gcloud delete, aws create, az create, provision, create bucket, create service, cloud run, lambda, IAM binding, service account, VPC, subnet, firewall rule, load balancer, cloud sql, RDS, pub/sub, SQS. NOT FOR reading cloud state (just run the describe/list command), and NOT FOR application deploys that do not change infrastructure.
---

# Infrastructure

**IaC is the only path for mutations.** Cloud CLIs and web consoles are for reading state, never for changing it.

The reason is not purity. A `gcloud` mutation creates state that no code describes, so the next `pulumi up` either reverts it or conflicts with it, and the drift is invisible until it breaks something. One command out-of-band costs an afternoon later.

## Two halves, and this is the smaller one

The mechanical gate lives in `hooks/lib/catastrophic-shapes.ts` — it matches cloud mutation verbs on any Bash command and floors the permission decision at a prompt. It fires whether or not this skill was loaded, which is the point.

This file is the procedure that prompt is asking you to follow. *(The predecessor shipped only the prose half, with `disable-model-invocation: true` and nothing routing to it, so it gated nothing for its entire life. Ported with teeth 2026-08-19.)*

## Ideal state

A mutation is done when:

- The change exists **as code** in the IaC project that owns that resource, matching the project's existing language, layout, and naming.
- `preview`/`plan` output was read and shown to Aaron **before** anything applied.
- Aaron explicitly approved the apply. Not implied by an earlier approval of the plan discussion — approved on the preview.
- Post-apply state was verified against the provider, not against the tool's own success message.

## Find the IaC project

Look in this order, and stop at the first hit:

1. Current working directory — `Pulumi.yaml`, `Pulumi.*.yaml`, `*.tf`, or an `infra/` directory holding them
2. Git root of the current repo
3. The repo that actually owns the resource, which is often not the one you are sitting in
4. Sibling repos, when the current one is part of a larger ecosystem

```bash
root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
find "$root" -maxdepth 3 \( -name 'Pulumi.yaml' -o -name '*.tf' \) 2>/dev/null
```

## When IaC exists

Read the project before writing into it — language, stack layout, how similar resources are already declared, naming conventions, which provider packages are imported. A change that does not look like its neighbors is a change the next person will not find.

Then write it, and preview:

```bash
pulumi preview          # or: terraform plan -out=tfplan
```

Show Aaron the code you wrote **and** the preview output, plus anything that concerns you — resources being replaced rather than updated, deletions, IAM widening, anything touching production. Ask, with `AskUserQuestion`, whether to apply.

**Never apply without that explicit yes.** `pulumi up --yes` and `terraform apply -auto-approve` both trip the hook, which is the intended second layer, not a nuisance to route around.

After applying, verify against the provider's authority API — not against the apply's own output. If the change touches anything serving live traffic or producing a metric, `~/.claude/doctrine/verification.md` rule 7 applies in full: baseline first, enumerate ownership before and after, confirm the flow continues at baseline.

## When IaC does not exist

**Stop and ask.** Present:

- What needs to change, and why
- That no IaC project was found for this resource
- The exact commands you would otherwise run

Then offer three options, and let Aaron pick:

- **A** — run the CLI command, accepting that it creates state outside IaC
- **B** — set up IaC for this resource first, then do it properly
- **C** — skip the change

Never run the mutation silently while narrating it as inevitable.

## Read-only is always fine

No approval needed, no ceremony — these change nothing:

| Provider | Safe |
|---|---|
| GCP | `gcloud ... describe`, `... list`, `... get-iam-policy`, `gsutil ls`, `gsutil cat` |
| AWS | `aws ... describe-*`, `... list-*`, `... get-*`, `aws s3 ls` |
| Azure | `az ... show`, `az ... list` |
| Pulumi | `pulumi preview`, `pulumi stack ls`, `pulumi stack output` |
| Terraform | `terraform plan`, `terraform show`, `terraform state list` |
| Kubernetes | `kubectl get`, `kubectl describe`, `kubectl logs` |

Reach for these freely. Investigating cloud state is not a gated act, and treating it as one is how the gate on the acts that *are* dangerous gets ignored.
