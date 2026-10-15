export type BookingResource={id:string;name:string;accountId:string;active:number;deleted:string|null};

export type FormSnapshot = {
    bookingMenus: BookingResource[]; bookingStaff: BookingResource[];
    account: {
        id: string;
        tenant: string | null;
        active: number;
        archived: string | null;
        liff: string | null;
    } | null;
    forms: {
        id: string;
        name: string;
        status: string;
        content_revision: number;
        owners: string[];
    }[];
    tags: {
        id: string;
        name: string;
        version: number;
        updated_at: string | null;
        status: string;
    }[];
    scenarios: {
        id: string;
        name: string;
        updated_at: string | null;
    }[];
    templates: {
        id: string;
        name: string;
        updated_at: string | null;
        draft_revision: number;
        published_version: number;
    }[];
};
