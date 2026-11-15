//행들 가지고 다니기 귀찮으니깐 일단 2차원벡터를 순회하면서 행번호만 따로 뽑아서 배열을 만들고 그 배열을 다뤄서 마지막에 정렬까지하고 배열의 값에 접근해서 answer을 체우자.
#include <string>
#include <vector>

using namespace std;

vector<vector<int>> solution(vector<vector<int>> data, string ext, int val_ext, string sort_by) {
    vector<vector<int>> answer;

    int extnum;
    if(ext=="code")
    {
        extnum=0;
    }else if(ext=="date")
    {
        extnum=1;
    }else if(ext=="maximum")
    {
        extnum=2;
    }else if(ext=="remain")
    {
        extnum=3;
    }

    //따로 행 전체를 들고다니지 않고 해당하는 행의 번호만 배열에 저장을 하려고 하는데 배열의 크기를 얼마로 잡아야 할지를 모르겠다. 2번돌리거나 크게만들고 사이즈를 들고다니거나
    int arrsize=0;
    for(int i=0;i<data.size();i++)
    {
        if(data[i][extnum]<val_ext)
        {
            arrsize++;
        }
    }
    
    int* indexarr = new int[arrsize];
    int k=0;
    for(int i=0;i<data.size();i++)
    {
        if(data[i][extnum]<val_ext)
        {
            indexarr[k]=i;
            k++;
        }
    }

    //배열을 가지고 for문을 돌릴건데 정렬을 어떤 식으로 완성시킬지 모르겠다.사다리for문 중첩을 통해서 일일이 비교하는 것이 당장에 떠오르는 최선이다.
    int sortnum;
    if(sort_by=="code")
    {
        sortnum=0;
    }else if(sort_by=="date")
    {
        sortnum=1;
    }else if(sort_by=="maximum")
    {
        sortnum=2;
    }else if(sort_by=="remain")
    {
        sortnum=3;
    }
    
    for(int i=0;i<arrsize-1;i++)
    {
        for(int j=i+1;j<arrsize;j++)
        {
            int icheck=indexarr[i];
            int jcheck=indexarr[j];
            if(data[icheck][sortnum]>data[jcheck][sortnum])
            {
                int swap;
                swap=indexarr[i];
                indexarr[i]=indexarr[j];
                indexarr[j]=swap;
            }
        }
    }

    for(int i=0;i<arrsize;i++)
    {
        answer.push_back(data[indexarr[i]]);    
    }

    return answer;
}