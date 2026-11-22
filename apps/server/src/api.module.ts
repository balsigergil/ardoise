// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AdminController, InstanceController, SetupController } from './admin/admin.controller.js';
import { AuthController, MeController } from './auth/auth.controller.js';
import { ApiErrorFilter } from './http/error-filter.js';
import { SessionGuard } from './http/session.guard.js';
import { PagesController, PublicPagesController } from './pages/pages.controller.js';
import { SyncController } from './sync/sync.controller.js';
import { SyncGateway } from './sync/sync.gateway.js';
import {
  InvitationsController,
  TeamspacesController,
  WorkspacesController,
} from './workspaces/workspaces.controller.js';

/** HTTP API of the `api` role (ARCHITECTURE §3: thin controllers over services). */
@Module({
  controllers: [
    AuthController,
    MeController,
    SetupController,
    InstanceController,
    AdminController,
    WorkspacesController,
    TeamspacesController,
    InvitationsController,
    SyncController,
    PagesController,
    PublicPagesController,
  ],
  providers: [
    SyncGateway,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class ApiModule {}
