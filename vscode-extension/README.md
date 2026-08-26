# FeltDB Runtime Investigations for VS Code

Receives durable runtime investigations published by the Runtime Investigator DevTools extension.

## Run locally

1. Start the application workspace with `feltdb dev`.
2. Run `npm install && npm run compile` in this directory.
3. Open this directory in VS Code and press `F5` to launch an Extension Development Host.
4. Choose **Connect** and enter the `FELT-XXXXXX` pairing code printed by `feltdb dev`.
5. In browser DevTools, investigate a request and choose **Send to IDE**.

The item appears immediately under **FeltDB → Runtime Investigations**. Selecting it opens the investigation details. **Show Source** navigates to the recorded initiator or trace location in the current VS Code workspace.

The detail view provides real **Open Source**, **View Trace**, **Compare**, and **Investigate** commands. Investigate marks the original FeltDB entity `INVESTIGATING` and hands observed evidence and the reported diagnosis to VS Code chat as separate sections. It requests analysis and proposed next steps only; it does not authorize file edits.

## Workspace contract

The extension subscribes to `runtime_investigations` through `@feltdb/core`. It also queries that collection after connecting so investigations remain available across VS Code restarts. No IDE polling or DevTools-specific transport is used.
