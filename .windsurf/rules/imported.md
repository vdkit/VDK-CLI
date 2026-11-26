---
description: Guidelines for AI assistants to effectively perform file operations within codebases
trigger:

---

# Project Context: VDK-CLI



## Current Setup

- **Framework**: express
- **Language**: typescript
- **Architecture**: spa
- **Technologies**: vitest, github-actions
- **Package Manager**: pnpm

## Detected Patterns

- utility-modules

---

description: Guidelines for AI assistants to effectively perform file operations within codebases.
globs: []
alwaysApply: false
version: "2.0.0"
lastUpdated: "2025-05-14"
compatibleWith: ["Memory-MCP","Sequential-Thinking-Advanced"]
---

# File Operations for AI Assistants



## Overview

Effective file operations are fundamental to AI-assisted development. This guide provides standardized patterns for AI assistants to create, read, modify, and manage files within a codebase in a safe, predictable manner that aligns with developer expectations.

## Core File Operation Principles

- **Non-destructive by Default**: Never delete or overwrite content without explicit confirmation.
- **Path Awareness**: Use absolute paths for clarity and to avoid ambiguity.
- **Atomic Operations**: Complete file operations fully or not at all to prevent partial states.
- **Validation First**: Check preconditions before performing operations.
- **Error Handling**: Anticipate and handle potential failure points.
- **Backup Consideration**: Consider backing up critical files before significant modifications.
- **Permission Awareness**: Respect file system permissions and restrictions.

## File Reading Operations



### Reading Entire Files

```javascript
// Pattern for reading entire files
async function readEntireFile(absolutePath) {
  // 1. Validate path
  if (!isValidPath(absolutePath)) {
    throw new Error(`Invalid path: ${absolutePath}`);
  }

  // 2. Check existence
  if (!fileExists(absolutePath)) {
    throw new Error(`File does not exist: ${absolutePath}`);
  }

  // 3. Read with proper error handling
  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    return content;
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
}
```

### Reading File Sections

```javascript
// Pattern for reading specific line ranges
async function readFileLines(absolutePath, startLine, endLine) {
  // 1. Validate path and line numbers
  if (!isValidPath(absolutePath) || startLine < 0 || endLine < startLine) {
    throw new Error(`Invalid parameters for file reading`);
  }

  // 2. Check existence
  if (!fileExists(absolutePath)) {
    throw new Error(`File does not exist: ${absolutePath}`);
  }

  // 3. Read with proper error handling
  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(startLine, endLine + 1).join('\n');
  } catch (error) {
    throw new Error(`Failed to read file lines: ${error.message}`);
  }
}
```

## File Writing Operations



### Creating New Files

```javascript
// Pattern for creating new files
async function createNewFile(absolutePath, content) {
  // 1. Validate path
  if (!isValidPath(absolutePath)) {
    throw new Error(`Invalid path: ${absolutePath}`);
  }

  // 2. Check if file already exists to prevent overwrites
  if (fileExists(absolutePath)) {
    throw new Error(`File already exists: ${absolutePath}`);
  }

  // 3. Ensure directory exists
  const directory = path.dirname(absolutePath);
  if (!directoryExists(directory)) {
    await fs.mkdir(directory, { recursive: true });
  }

  // 4. Write file with proper error handling
  try {
    await fs.writeFile(absolutePath, content, 'utf-8');
    return true;
  } catch (error) {
    throw new Error(`Failed to create file: ${error.message}`);
  }
}
```

### Modifying Existing Files

```javascript
// Pattern for modifying existing files
async function modifyFile(absolutePath, modifications) {
  // 1. Validate path
  if (!isValidPath(absolutePath)) {
    throw new Error(`Invalid path: ${absolutePath}`);
  }

  // 2. Check file exists
  if (!fileExists(absolutePath)) {
    throw new Error(`File does not exist: ${absolutePath}`);
  }

  // 3. Read current content
  let content;
  try {
    content = await fs.readFile(absolutePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read file for modification: ${error.message}`);
  }

  // 4. Apply modifications (with potential backup)
  const originalContent = content;
  try {
    // Apply each modification - example for line replacements
    for (const mod of modifications) {
      if (mod.type === 'replace') {
        content = content.replace(mod.target, mod.replacement);
      } else if (mod.type === 'insert') {
        // Handle other modification types
      }
    }

    // 5. Write back with proper error handling
    await fs.writeFile(absolutePath, content, 'utf-8');
    return true;
  } catch (error) {
    // 6. Consider restoring from backup on failure
    throw new Error(`Failed to modify file: ${error.message}`);
  }
}
```

### Safe File Replacement Pattern

```javascript
// Pattern for safely replacing entire file contents
async function safelyReplaceFile(absolutePath, newContent) {
  // 1. Validate inputs
  if (!isValidPath(absolutePath) || newContent === undefined) {
    throw new Error(`Invalid parameters for file replacement`);
  }

  // 2. Check file exists
  if (!fileExists(absolutePath)) {
    throw new Error(`File does not exist: ${absolutePath}`);
  }

  // 3. Create backup
  const backupPath = `${absolutePath}.bak`;
  try {
    await fs.copyFile(absolutePath, backupPath);
  } catch (error) {
    throw new Error(`Failed to create backup: ${error.message}`);
  }

  // 4. Write new content
  try {
    await fs.writeFile(absolutePath, newContent, 'utf-8');
    // 5. Remove backup if successful
    await fs.unlink(backupPath);
    return true;
  } catch (error) {
    // 6. Restore from backup 

*Truncated due to character limit*