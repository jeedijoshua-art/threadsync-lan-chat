#include <stdio.h>
#include <stdlib.h>

void fcfs(int req[], int n, int head) {
    int seek = 0;

    printf("\n--- FCFS ---\n");
    for(int i = 0; i < n; i++) {
        seek += abs(req[i] - head);
        head = req[i];
    }

    printf("Total Seek Time = %d\n", seek);
}

void sstf(int req[], int n, int head) {
    int visited[20] = {0};
    int seek = 0;

    printf("\n--- SSTF ---\n");

    for(int i = 0; i < n; i++) {
        int min = 9999, index = -1;

        for(int j = 0; j < n; j++) {
            if(!visited[j] && abs(req[j] - head) < min) {
                min = abs(req[j] - head);
                index = j;
            }
        }

        seek += min;
        head = req[index];
        visited[index] = 1;
    }

    printf("Total Seek Time = %d\n", seek);
}

void scan(int req[], int n, int head, int size) {
    int seek = 0;

    printf("\n--- SCAN ---\n");

    // sort requests
    for(int i = 0; i < n-1; i++)
        for(int j = i+1; j < n; j++)
            if(req[i] > req[j]) {
                int temp = req[i];
                req[i] = req[j];
                req[j] = temp;
            }

    int i;
    for(i = 0; i < n; i++)
        if(req[i] > head)
            break;

    // move right
    for(int j = i; j < n; j++) {
        seek += abs(req[j] - head);
        head = req[j];
    }

    // go to end
    seek += abs(size - head);
    head = size;

    // move left
    for(int j = i-1; j >= 0; j--) {
        seek += abs(req[j] - head);
        head = req[j];
    }

    printf("Total Seek Time = %d\n", seek);
}

void look(int req[], int n, int head) {
    int seek = 0;

    printf("\n--- LOOK ---\n");

    // sort
    for(int i = 0; i < n-1; i++)
        for(int j = i+1; j < n; j++)
            if(req[i] > req[j]) {
                int temp = req[i];
                req[i] = req[j];
                req[j] = temp;
            }

    int i;
    for(i = 0; i < n; i++)
        if(req[i] > head)
            break;

    // right
    for(int j = i; j < n; j++) {
        seek += abs(req[j] - head);
        head = req[j];
    }

    // left
    for(int j = i-1; j >= 0; j--) {
        seek += abs(req[j] - head);
        head = req[j];
    }

    printf("Total Seek Time = %d\n", seek);
}

int main() {
    int n, head, choice;

    printf("Enter number of patient requests: ");
    scanf("%d", &n);

    int req[20];

    printf("Enter request queue:\n");
    for(int i = 0; i < n; i++)
        scanf("%d", &req[i]);

    printf("Enter initial head position: ");
    scanf("%d", &head);

    printf("\n1. FCFS\n2. SSTF\n3. SCAN\n4. LOOK\n");
    printf("Enter choice: ");
    scanf("%d", &choice);

    if(choice == 1)
        fcfs(req, n, head);
    else if(choice == 2)
        sstf(req, n, head);
    else if(choice == 3) {
        int size;
        printf("Enter disk size: ");
        scanf("%d", &size);
        scan(req, n, head, size);
    }
    else if(choice == 4)
        look(req, n, head);
    else
        printf("Invalid choice\n");

    return 0;
}